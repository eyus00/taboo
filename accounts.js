// Accounts: a number, a four-digit PIN, and a record kept in a database.
//
// Nobody needs one to play. An account is for whoever wants their record (and the
// character they chose) kept somewhere safer than one browser: the next free number is
// theirs - 1, 2, 3... - and a PIN of four digits lets them in from another device.
//
// What this file is careful about, and why:
//
// - A PIN is ten thousand possibilities and the numbers are no secret, so the PIN is never
//   what keeps an account safe - the limits are. Five wrong tries lock that one account for
//   a quarter of an hour, and for twice as long each time it happens again. The commonest
//   PINs are refused. A PIN is only ever used to add a device: after that the device holds
//   a long random token (we keep only a hash of it), which is what is checked from then on.
// - PINs are stored hashed (scrypt, a salt of their own, and a secret that is not in the
//   database), so a copy of the database alone does not give them away.
// - Accounts cannot be made by the bucketful. One is only given to someone who has played
//   NEED_ROUNDS rounds to the buzzer: the server hands out a signed ticket that counts
//   them, a ticket makes one account and no more, and there is a ceiling on new accounts
//   per hour for the whole server. (Nothing is limited per network address: a school is
//   one address.)
// - A forgotten PIN has no automatic way back - there is no e-mail to send anything to. The
//   owner of the server makes a one-time code on the admin page and hands it over; with it
//   the player sets a new PIN, and every device that was signed in is signed out.
// - The game never waits for the database. A record is counted in memory when a round
//   ends and written in the background; if the database is slow or away, the write is
//   tried again later.
//
// This file knows nothing about sockets or HTTP: server.js wires it up. It is handed one
// function, query(text, params) -> Promise<{ rows }>, which is all it needs of a database
// (pg's Pool has one; so has the in-memory Postgres the tests use).

import crypto from 'node:crypto';
import { blank, tidy, countRound, countCup, idish, int } from './shared/record.js';

export const NEED_ROUNDS = 3; // rounds played before an account can be made
const PIN_TRIES = 5; // wrong PINs before the account is locked...
const LOCK_MS = 15 * 60 * 1000; // ...for this long the first time, twice as long each time after
const LOCK_MAX_MS = 24 * 60 * 60 * 1000;
const RESET_MS = 24 * 60 * 60 * 1000; // how long a reset code is good for
const SESSIONS_MAX = 8; // devices signed in to one account (the oldest goes)
export const FRIENDS_MAX = 100; // friends one account can have (asked and not yet answered count too)
const ASKED_MAX = 20; // requests one account can have out, unanswered, at once
const WAITING_MAX = 50; // requests that can be waiting on one account
const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000; // someone who said no is not asked again for this long
const RETRY_MS = 5000; // a failed write is tried again after this (and then less often)
// (the PINs people choose first: every digit the same, the runs, the corners of the pad, the years nobody will guess)
const COMMON = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '2345', '3456', '4567', '5678', '6789', '9876', '1212', '2121', '1122', '1313', '2580', '0852', '1379', '6969', '1010', '2000', '2020', '2024', '2025', '2026']);

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const scrypt = (pin, salt) => new Promise((resolve, reject) => crypto.scrypt(String(pin), salt, 32, (err, key) => (err ? reject(err) : resolve(key))));
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
const num = (v) => (v == null ? 0 : Number(v));
export const validPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    look_style TEXT NOT NULL DEFAULT 'ink',
    look_colour SMALLINT NOT NULL DEFAULT 0,
    record JSONB NOT NULL,
    ticket TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'ok',
    fails SMALLINT NOT NULL DEFAULT 0,
    locks SMALLINT NOT NULL DEFAULT 0,
    locked_until BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    seen_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    used_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id)`,
  `CREATE TABLE IF NOT EXISTS resets (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at BIGINT NOT NULL
  )`,
  // Friends: one row for every pair, the lower number first. state: asked (by `asker`, not
  // answered yet) | ok (friends) | no (the other said no: to `asker` it still looks asked) |
  // gone (a no that `asker` then took back: shown to nobody, kept so that it is not asked again at once).
  `CREATE TABLE IF NOT EXISTS friends (
    a INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    b INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    state TEXT NOT NULL,
    asker INTEGER NOT NULL,
    at BIGINT NOT NULL,
    PRIMARY KEY (a, b),
    CHECK (a < b)
  )`,
  `CREATE INDEX IF NOT EXISTS friends_b ON friends (b)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_log (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at BIGINT NOT NULL,
    action TEXT NOT NULL,
    account_id INTEGER,
    note TEXT NOT NULL DEFAULT ''
  )`,
];

// what an account looks like to its owner
const shape = (row) => {
  const look = { style: idish(row.look_style) ? row.look_style : 'ink', colour: int(num(row.look_colour), 9) };
  const record = tidy({ ...(typeof row.record === 'string' ? JSON.parse(row.record) : row.record), name: row.name, look });
  return { id: num(row.id), name: row.name, look, record };
};

//   query(text, params) -> Promise<{ rows }>
//   secret: a long string that is not in the database (PINs are hashed with it, tickets signed with it)
//   perHour: the most new accounts the whole server makes in an hour
//   need: rounds played before an account can be made
//   now: the clock (the tests have their own)
export function makeAccounts({ query, secret, perHour = 120, need = NEED_ROUNDS, now = () => Date.now(), log = () => {} }) {
  const key = crypto.createHash('sha256').update(`onigokko:${secret}`).digest();
  const live = new Map(); // id -> { name, look, record }: the accounts in use right now, as they are in memory
  const dirty = new Set(); // ids whose record has not been written yet
  let writing = false;
  let retry = RETRY_MS;
  let timer = null;
  let paused = false; // sign-ups switched off by the owner
  const made = []; // when the accounts of the last hour were made

  const hashPin = async (pin, salt) => (await scrypt(pin, Buffer.concat([Buffer.from(salt, 'hex'), key]))).toString('hex');
  const checkPin = async (pin, row) => same(Buffer.from(await hashPin(pin, row.pin_salt), 'hex'), Buffer.from(row.pin_hash, 'hex'));
  const badPin = (pin) => (!validPin(pin) ? 'A PIN is four digits.' : COMMON.has(pin) ? 'That PIN is one of the first anyone would try. Choose another.' : '');

  // --- tickets: proof of rounds played -----------------------------------------------------
  // "tid.n.signature": tid names the ticket (one ticket, one account), n is how many rounds it has seen
  const sign = (tid, n) => crypto.createHmac('sha256', key).update(`${tid}.${n}`).digest('hex').slice(0, 32);
  const ticket = ({ tid, n }) => `${tid}.${n}.${sign(tid, n)}`;
  function readTicket(text) {
    const m = /^([a-f0-9]{16})\.(\d{1,6})\.([a-f0-9]{32})$/.exec(String(text || ''));
    if (!m) return null;
    const n = Number(m[2]);
    return same(Buffer.from(m[3]), Buffer.from(sign(m[1], n))) ? { tid: m[1], n } : null;
  }
  const newTicket = () => ({ tid: crypto.randomBytes(8).toString('hex'), n: 0 });

  // --- writing records in the background ------------------------------------------------------
  function flushSoon(ms = 400) {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, ms);
    timer.unref?.();
  }
  async function flush() {
    if (writing) return flushSoon();
    writing = true;
    try {
      for (const id of [...dirty]) {
        const a = live.get(id);
        dirty.delete(id);
        if (!a) continue;
        try {
          await query('UPDATE accounts SET record = $1, seen_at = $2 WHERE id = $3', [JSON.stringify(a.record), now(), id]);
        } catch (err) {
          dirty.add(id); // (still owed: tried again below)
          throw err;
        }
      }
      retry = RETRY_MS;
    } catch (err) {
      log(`accounts: a record could not be written (${err.message}); trying again in ${Math.round(retry / 1000)} s`);
      flushSoon(retry);
      retry = Math.min(retry * 2, 60000);
    } finally {
      writing = false;
    }
  }

  // --- signing in ---------------------------------------------------------------------------------
  async function startSession(id) {
    const token = crypto.randomBytes(24).toString('base64url');
    const t = now();
    await query('INSERT INTO sessions (token_hash, account_id, created_at, used_at) VALUES ($1, $2, $3, $3)', [sha(token), id, t]);
    // (no more than a handful of devices: the one used longest ago goes)
    await query('DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $3 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id = $1 AND token_hash <> $3 ORDER BY used_at DESC LIMIT $2)', [id, SESSIONS_MAX - 1, sha(token)]);
    return token;
  }
  // an account that is in use: one copy of it in memory, whoever asks
  function hold(row) {
    const a = shape(row);
    // (what is in memory already is at least as new as what is in the database)
    if (!live.has(a.id)) live.set(a.id, { name: a.name, look: a.look, record: a.record });
    return view(a.id);
  }
  function view(id) {
    const a = live.get(id);
    return a ? { id, name: a.name, look: { ...a.look }, record: { ...structuredClone(a.record), name: a.name, look: { ...a.look } } } : null;
  }
  // A wrong PIN (or reset code): counted against the account, which is locked when there have been too many.
  async function wrong(row) {
    let fails = num(row.fails) + 1;
    let locks = num(row.locks);
    let until = 0;
    if (fails >= PIN_TRIES) {
      fails = 0;
      locks = Math.min(locks + 1, 20);
      until = now() + Math.min(LOCK_MS * 2 ** (locks - 1), LOCK_MAX_MS);
    }
    await query('UPDATE accounts SET fails = $1, locks = $2, locked_until = $3 WHERE id = $4', [fails, locks, until, row.id]);
    if (until) return { error: `Too many wrong tries. This account is locked for ${Math.ceil((until - now()) / 60000)} minutes.`, wait: until - now() };
    return { error: `That is not right. ${PIN_TRIES - fails} more ${PIN_TRIES - fails === 1 ? 'try' : 'tries'} before the account is locked for a while.` };
  }
  const lockedOut = (row) => {
    const left = num(row.locked_until) - now();
    return left > 0 ? { error: `Too many wrong tries. This account is locked for another ${Math.ceil(left / 60000)} minutes.`, wait: left } : null;
  };
  async function find(id) {
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return null;
    return (await query('SELECT * FROM accounts WHERE id = $1', [id])).rows[0] || null;
  }

  const api = {
    need,
    get paused() {
      return paused;
    },
    ticket,
    readTicket,
    newTicket,
    validPin,

    async init() {
      for (const sql of SCHEMA) await query(sql);
      paused = (await query("SELECT value FROM settings WHERE key = 'signups'")).rows[0]?.value === 'off';
    },

    // A new account: the next number. `played` is the ticket this connection holds.
    async create({ pin, name, look, record, played }) {
      if (paused) return { error: 'New accounts are switched off for the moment.' };
      const bad = badPin(pin);
      if (bad) return { error: bad };
      if (!name) return { error: 'Enter your name first.' };
      if (!played || played.n < need) return { error: `Play ${need - (played?.n || 0)} more ${need - (played?.n || 0) === 1 ? 'round' : 'rounds'} first.`, need: need - (played?.n || 0) };
      const t = now();
      while (made.length && t - made[0] > 3600000) made.shift();
      if (made.length >= perHour) return { error: 'A lot of accounts have just been made. Try again in a little while.' };
      // (asked first, so that a refusal does not use up a number)
      const used = { error: 'An account has already been made from here. Play a few more rounds first.', need };
      if ((await query('SELECT 1 FROM accounts WHERE ticket = $1', [played.tid])).rows.length) return used;
      const salt = crypto.randomBytes(16).toString('hex');
      const style = idish(look?.style) ? look.style : 'ink';
      const colour = int(look?.colour, 9);
      const rec = tidy({ ...record, name, look: { style, colour } });
      let row;
      try {
        row = (await query('INSERT INTO accounts (name, pin_hash, pin_salt, look_style, look_colour, record, ticket, created_at, seen_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *', [name, await hashPin(pin, salt), salt, style, colour, JSON.stringify(rec), played.tid, t])).rows[0];
      } catch (err) {
        if (err.code === '23505') return used; // (two at the same moment: this ticket has made its one account)
        throw err;
      }
      made.push(t);
      const account = hold(row);
      return { ok: true, token: await startSession(account.id), account };
    },

    // On another device: the number and the PIN.
    async signIn(id, pin) {
      const row = await find(id);
      if (!row || !validPin(pin)) return { error: 'No account with that number and PIN.' };
      if (row.status !== 'ok') return { error: 'This account has been closed.' };
      const locked = lockedOut(row);
      if (locked) return locked;
      if (!(await checkPin(pin, row))) return wrong(row);
      await query('UPDATE accounts SET fails = 0, locks = 0, locked_until = 0, seen_at = $1 WHERE id = $2', [now(), row.id]);
      const account = hold(row);
      return { ok: true, token: await startSession(account.id), account };
    },

    // A device that is signed in already: its token.
    async resume(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 80) return null;
      const s = (await query('SELECT account_id FROM sessions WHERE token_hash = $1', [sha(token)])).rows[0];
      if (!s) return null;
      const row = await find(num(s.account_id));
      if (!row || row.status !== 'ok') return null;
      await query('UPDATE sessions SET used_at = $1 WHERE token_hash = $2', [now(), sha(token)]);
      return hold(row);
    },

    async signOut(token, { everywhere = false, id = 0 } = {}) {
      if (everywhere && id) await query('DELETE FROM sessions WHERE account_id = $1', [id]);
      else if (typeof token === 'string') await query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
      return { ok: true };
    },

    // A new PIN, from a device that is signed in (no need for the old one: the token is the proof).
    // Every other device is signed out.
    async setPin(id, pin, token) {
      const bad = badPin(pin);
      if (bad) return { error: bad };
      const salt = crypto.randomBytes(16).toString('hex');
      await query('UPDATE accounts SET pin_hash = $1, pin_salt = $2, fails = 0, locks = 0, locked_until = 0 WHERE id = $3', [await hashPin(pin, salt), salt, id]);
      await query('DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2', [id, sha(token || '')]);
      return { ok: true };
    },

    // The PIN is forgotten: a code from the owner of the server, and a new PIN.
    async useReset(id, code, pin) {
      const row = await find(id);
      const r = row ? (await query('SELECT * FROM resets WHERE account_id = $1', [id])).rows[0] : null;
      if (!row || !r || typeof code !== 'string') return { error: 'No reset is waiting for that account. Ask whoever runs the game for a code.' };
      if (row.status !== 'ok') return { error: 'This account has been closed.' };
      const locked = lockedOut(row);
      if (locked) return locked;
      if (num(r.expires_at) < now()) {
        await query('DELETE FROM resets WHERE account_id = $1', [id]);
        return { error: 'That code has run out. Ask for a new one.' };
      }
      if (!same(Buffer.from(sha(code.trim().toUpperCase())), Buffer.from(r.code_hash))) return wrong(row);
      const bad = badPin(pin);
      if (bad) return { error: bad };
      const salt = crypto.randomBytes(16).toString('hex');
      await query('UPDATE accounts SET pin_hash = $1, pin_salt = $2, fails = 0, locks = 0, locked_until = 0 WHERE id = $3', [await hashPin(pin, salt), salt, id]);
      await query('DELETE FROM resets WHERE account_id = $1', [id]);
      await query('DELETE FROM sessions WHERE account_id = $1', [id]);
      const account = hold(row);
      return { ok: true, token: await startSession(id), account };
    },

    // Gone for good, at its owner's word (the PIN, once more, to be sure it is theirs to give).
    async remove(id, pin) {
      const row = await find(id);
      if (!row) return { error: 'No such account.' };
      const locked = lockedOut(row);
      if (locked) return locked;
      if (!validPin(pin) || !(await checkPin(pin, row))) return wrong(row);
      await query('DELETE FROM accounts WHERE id = $1', [id]);
      live.delete(id);
      dirty.delete(id);
      return { ok: true };
    },

    // the name and the character, as the owner has just changed them
    async saveProfile(id, { name, look }) {
      const a = live.get(id);
      if (!a) return { error: 'Not signed in.' };
      if (name) a.name = name;
      if (idish(look?.style)) a.look = { style: look.style, colour: int(look.colour, 9) };
      await query('UPDATE accounts SET name = $1, look_style = $2, look_colour = $3 WHERE id = $4', [a.name, a.look.style, a.look.colour, id]);
      return { ok: true };
    },

    view,
    // nobody is using this account any more: what is owed is written, then it is let go of
    async release(id) {
      if (dirty.has(id)) await flush();
      if (!dirty.has(id)) live.delete(id);
    },

    // --- counting (in memory now, in the database a moment later) ---------------------------------
    // a round has ended: res is its 'end' message, ctx = { slot, theme, arena, duration }
    count(id, res, ctx) {
      const a = live.get(id);
      if (!a) return null;
      if (countRound(a.record, res, ctx, now())) {
        dirty.add(id);
        flushSoon();
      }
      return view(id).record;
    },
    cup(id, kind, won) {
      const a = live.get(id);
      if (!a) return null;
      if (countCup(a.record, kind, won)) {
        dirty.add(id);
        flushSoon();
      }
      return view(id).record;
    },
    flush,
    get owed() {
      return dirty.size;
    },

    // --- what anybody may know of an account: the name, the character, a few numbers ---------------
    //   viewer: the account that is asking (0: nobody signed in) - `state` says what they are to each other:
    //   me | friends | asked (by the viewer) | incoming (they asked the viewer) | none
    async card(id, viewer = 0) {
      const row = await find(id);
      if (!row || row.status !== 'ok') return { error: 'No such player.' };
      const a = live.get(id) ? view(id) : shape(row);
      const r = a.record;
      let state = id === viewer ? 'me' : 'none';
      if (viewer && viewer !== id) {
        const f = (await query('SELECT state, asker FROM friends WHERE a = $1 AND b = $2', [Math.min(id, viewer), Math.max(id, viewer)])).rows[0];
        if (f) state = f.state === 'ok' ? 'friends' : f.state === 'gone' ? 'none' : num(f.asker) === viewer ? 'asked' : f.state === 'asked' ? 'incoming' : 'none';
      }
      return { ok: true, card: { id, name: a.name, look: [a.look.style, a.look.colour], since: num(row.created_at), rounds: r.rounds, wins: r.wins, best: r.best, cups: r.cups.ko.won + r.cups.team.won, state } };
    },

    // --- friends -----------------------------------------------------------------------------------
    // Both sides have an account; one asks, the other says yes or no. Nobody is told they
    // were turned down: to whoever asked, a request that got a no simply stays asked.
    friends: {
      // everyone `id` has to do with: { friends, incoming, outgoing }, each [{ id, name, look: [style, colour] }]
      async list(id) {
        const rows = (
          await query(
            `SELECT f.state, f.asker, o.id, o.name, o.look_style, o.look_colour
               FROM friends f JOIN accounts o ON o.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
              WHERE (f.a = $1 OR f.b = $1) AND o.status = 'ok' ORDER BY lower(o.name), o.id`,
            [id],
          )
        ).rows;
        const out = { friends: [], incoming: [], outgoing: [] };
        for (const r of rows) {
          const who = { id: num(r.id), name: live.get(num(r.id))?.name || r.name, look: [idish(r.look_style) ? r.look_style : 'ink', int(num(r.look_colour), 9)] };
          const mine = num(r.asker) === id;
          if (r.state === 'ok') out.friends.push(who);
          else if (r.state === 'gone') continue;
          else if (mine) out.outgoing.push(who); // (asked, or turned down: the same to whoever asked)
          else if (r.state === 'asked') out.incoming.push(who);
        }
        return out;
      },
      // the numbers of `id`'s friends (who is to be told when they come and go)
      async ids(id) {
        return (await query("SELECT CASE WHEN a = $1 THEN b ELSE a END AS id FROM friends WHERE (a = $1 OR b = $1) AND state = 'ok'", [id])).rows.map((r) => num(r.id));
      },
      async are(x, y) {
        if (!x || !y || x === y) return false;
        return !!(await query("SELECT 1 FROM friends WHERE a = $1 AND b = $2 AND state = 'ok'", [Math.min(x, y), Math.max(x, y)])).rows[0];
      },
      // `me` asks `other` - or, if `other` had asked already, says yes
      //   -> { ok, state: 'asked' | 'friends', news: true when `other` should be told }
      async ask(me, other) {
        if (!Number.isInteger(other) || other < 1) return { error: 'Enter a player number.' };
        if (other === me) return { error: 'That is your own number.' };
        const them = await find(other);
        if (!them || them.status !== 'ok') return { error: `There is no player #${other}.` };
        const [a, b] = [Math.min(me, other), Math.max(me, other)];
        const row = (await query('SELECT state, asker, at FROM friends WHERE a = $1 AND b = $2', [a, b])).rows[0];
        if (row?.state === 'ok') return { ok: true, state: 'friends', name: them.name };
        if (row && num(row.asker) === other && row.state !== 'gone') {
          // they asked first (even if that got a no at the time): asking back makes it so
          if ((await api.friends.count(me)).friends >= FRIENDS_MAX) return { error: `A friends list holds ${FRIENDS_MAX}. Make room first.` };
          await query("UPDATE friends SET state = 'ok', at = $3 WHERE a = $1 AND b = $2", [a, b, now()]);
          return { ok: true, state: 'friends', name: them.name, news: true };
        }
        if (row?.state === 'asked') return { ok: true, state: 'asked', name: them.name };
        if (row && num(row.asker) === me && (row.state === 'no' || row.state === 'gone') && now() - num(row.at) < ASK_AGAIN_MS) {
          // (not again so soon - and not a word about it: to whoever asks, it is asked)
          if (row.state === 'gone') await query("UPDATE friends SET state = 'no' WHERE a = $1 AND b = $2", [a, b]);
          return { ok: true, state: 'asked', name: them.name };
        }
        const mine = await api.friends.count(me);
        if (mine.friends + mine.asked >= FRIENDS_MAX) return { error: `A friends list holds ${FRIENDS_MAX}. Make room first.` };
        if (mine.asked >= ASKED_MAX) return { error: 'You have a lot of requests waiting for an answer. Wait for some of them first.' };
        if ((await api.friends.count(other)).waiting >= WAITING_MAX) return { error: 'They have more requests than they can answer just now.' };
        await query(
          "INSERT INTO friends (a, b, state, asker, at) VALUES ($1, $2, 'asked', $3, $4) ON CONFLICT (a, b) DO UPDATE SET state = 'asked', asker = $3, at = $4",
          [a, b, me, now()],
        );
        return { ok: true, state: 'asked', name: them.name, news: true };
      },
      // how full `id`'s lists are: friends, asked (by them, unanswered or turned down), waiting (on them)
      async count(id) {
        const r = (
          await query(
            `SELECT count(*) FILTER (WHERE state = 'ok') AS friends,
                    count(*) FILTER (WHERE state IN ('asked', 'no') AND asker = $1) AS asked,
                    count(*) FILTER (WHERE state = 'asked' AND asker <> $1) AS waiting
               FROM friends WHERE a = $1 OR b = $1`,
            [id],
          )
        ).rows[0];
        return { friends: num(r.friends), asked: num(r.asked), waiting: num(r.waiting) };
      },
      // `me` answers `other`'s request
      async answer(me, other, yes) {
        const [a, b] = [Math.min(me, other), Math.max(me, other)];
        const row = (await query('SELECT state, asker FROM friends WHERE a = $1 AND b = $2', [a, b])).rows[0];
        if (!row || row.state !== 'asked' || num(row.asker) !== other) return { error: 'That request is no longer there.' };
        if (yes && (await api.friends.count(me)).friends >= FRIENDS_MAX) return { error: `A friends list holds ${FRIENDS_MAX}. Make room first.` };
        await query('UPDATE friends SET state = $3, at = $4 WHERE a = $1 AND b = $2', [a, b, yes ? 'ok' : 'no', now()]);
        return { ok: true, state: yes ? 'friends' : 'none', news: !!yes };
      },
      // `me` is done with `other`: no longer friends, or a request of their own taken back
      // (a request of the other's is answered, not removed: see answer)
      async remove(me, other) {
        const [a, b] = [Math.min(me, other), Math.max(me, other)];
        const row = (await query('SELECT state, asker FROM friends WHERE a = $1 AND b = $2', [a, b])).rows[0];
        if (!row) return { ok: true, state: 'none' };
        if (row.state !== 'ok' && num(row.asker) !== me) return row.state === 'asked' ? api.friends.answer(me, other, false) : { ok: true, state: 'none' };
        // (a request that got a no stays on the books until it may be made again: taking it back does not clear the way)
        if (row.state === 'no' || row.state === 'gone') {
          await query("UPDATE friends SET state = 'gone' WHERE a = $1 AND b = $2", [a, b]);
          return { ok: true, state: 'none' };
        }
        await query('DELETE FROM friends WHERE a = $1 AND b = $2', [a, b]);
        return { ok: true, state: 'none', news: row.state === 'ok' };
      },
    },

    // --- for the owner of the server (the admin page) -------------------------------------------
    admin: {
      async overview() {
        const total = num((await query('SELECT count(*) AS n FROM accounts')).rows[0].n);
        const rows = (await query('SELECT id, name, status, created_at, seen_at, locked_until, record FROM accounts ORDER BY id DESC LIMIT 40')).rows;
        const t = now();
        return { total, paused, perHour, lastHour: made.filter((x) => t - x <= 3600000).length, need, accounts: rows.map((r) => api.admin.brief(r)), log: (await query('SELECT at, action, account_id, note FROM admin_log ORDER BY id DESC LIMIT 20')).rows.map((l) => ({ at: num(l.at), action: l.action, id: num(l.account_id), note: l.note })) };
      },
      brief(r) {
        const rec = typeof r.record === 'string' ? JSON.parse(r.record) : r.record;
        return { id: num(r.id), name: r.name, status: r.status, created: num(r.created_at), seen: num(r.seen_at), locked: num(r.locked_until) > now(), rounds: int(live.get(num(r.id))?.record.rounds ?? rec?.rounds) };
      },
      async find(id) {
        const row = await find(id);
        return row ? api.admin.brief(row) : null;
      },
      // a one-time code that lets this account's owner set a new PIN
      async reset(id) {
        const row = await find(id);
        if (!row) return { error: 'No such account.' };
        const code = Array.from(crypto.randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
        const expires = now() + RESET_MS;
        await query('INSERT INTO resets (account_id, code_hash, expires_at) VALUES ($1, $2, $3) ON CONFLICT (account_id) DO UPDATE SET code_hash = $2, expires_at = $3', [id, sha(code), expires]);
        await query('UPDATE accounts SET fails = 0, locked_until = 0 WHERE id = $1', [id]);
        await api.admin.note('reset', id, 'a reset code was made');
        return { ok: true, code, expires };
      },
      async ban(id, on) {
        const row = await find(id);
        if (!row) return { error: 'No such account.' };
        await query('UPDATE accounts SET status = $1 WHERE id = $2', [on ? 'closed' : 'ok', id]);
        if (on) await query('DELETE FROM sessions WHERE account_id = $1', [id]);
        await api.admin.note(on ? 'close' : 'open', id, row.name);
        return { ok: true };
      },
      async remove(id) {
        const row = await find(id);
        if (!row) return { error: 'No such account.' };
        await query('DELETE FROM accounts WHERE id = $1', [id]);
        live.delete(id);
        dirty.delete(id);
        await api.admin.note('delete', id, row.name);
        return { ok: true };
      },
      async pause(on) {
        paused = !!on;
        await query("INSERT INTO settings (key, value) VALUES ('signups', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [paused ? 'off' : 'on']);
        await api.admin.note(paused ? 'pause' : 'resume', null, 'new accounts');
        return { ok: true, paused };
      },
      note: (action, id, note) => query('INSERT INTO admin_log (at, action, account_id, note) VALUES ($1, $2, $3, $4)', [now(), action, id, String(note || '').slice(0, 200)]),
    },
  };
  return api;
}

export { blank };
