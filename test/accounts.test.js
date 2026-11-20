// Accounts, against a real Postgres that lives in memory (PGlite): numbers, PINs, the limits,
// tickets, sessions, resets, counting and writing. No server, no sockets.
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { makeAccounts } from '../accounts.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}
const db = new PGlite();
let clock = 1_800_000_000_000;
let broken = false; // (the database "goes away")
const query = (text, params) => (broken ? Promise.reject(new Error('the database is away')) : db.query(text, params));
const A = makeAccounts({ query, secret: 'test-secret', perHour: 6, now: () => clock, log: () => {} });
await A.init();
const played = (n) => ({ ...A.newTicket(), n });
const round = (slot, o = {}) => ({ mode: 'potato', reason: 'time', rows: [{ slot, name: 'x', ms: 1000, tags: 1, team: 0, boom: false, caps: 0, plus: 0, minus: 0 }, { slot: 9, name: 'y', ms: 0, tags: 0, team: 1 }], winners: [slot], loser: 9, team: null, cup: null, ...o });

await test('an account is the next number; it needs a name, a proper PIN and three rounds played', async () => {
  assert.match((await A.create({ pin: '4827', name: 'Hana', played: played(2) })).error, /Play 1 more round first/);
  assert.match((await A.create({ pin: '4827', name: 'Hana', played: null })).error, /Play 3 more rounds/);
  assert.match((await A.create({ pin: '48', name: 'Hana', played: played(3) })).error, /four digits/);
  assert.match((await A.create({ pin: '1234', name: 'Hana', played: played(3) })).error, /first anyone would try/);
  assert.match((await A.create({ pin: '7777', name: 'Hana', played: played(3) })).error, /first anyone would try/);
  assert.match((await A.create({ pin: '4827', name: '', played: played(3) })).error, /name/);
  const one = await A.create({ pin: '4827', name: 'Hana', look: { style: 'shadow', colour: 4 }, record: { app: 'onigokko', kind: 'profile', v: 1, rounds: 7, wins: 99, extra: 'x' }, played: played(3) });
  assert.ok(one.ok && one.token.length > 20);
  assert.deepEqual([one.account.id, one.account.name, one.account.look], [1, 'Hana', { style: 'shadow', colour: 4 }]);
  assert.deepEqual([one.account.record.rounds, one.account.record.wins, 'extra' in one.account.record], [7, 7, false], 'what is brought along is put right first');
  const two = await A.create({ pin: '9053', name: 'Kenji', played: played(5) });
  assert.equal(two.account.id, 2);
  // the PIN is not in the database, nor is the token
  const raw = (await db.query('SELECT * FROM accounts WHERE id = 1')).rows[0];
  assert.ok(!JSON.stringify(raw).includes('4827') && raw.pin_hash.length === 64);
  assert.ok(!JSON.stringify((await db.query('SELECT * FROM sessions')).rows).includes(one.token));
});

await test('one ticket makes one account; a ticket cannot be forged or raised', async () => {
  const t = played(3);
  assert.ok((await A.create({ pin: '3310', name: 'Mio', played: t })).ok);
  assert.match((await A.create({ pin: '3311', name: 'Mio2', played: t })).error, /already been made from here/);
  const text = A.ticket({ tid: t.tid, n: 3 });
  assert.deepEqual(A.readTicket(text), { tid: t.tid, n: 3 });
  assert.equal(A.readTicket(text.replace('.3.', '.9.')), null, 'the count is signed');
  assert.equal(A.readTicket('x'.repeat(40)), null);
  assert.equal(A.readTicket(`${'a'.repeat(16)}.3.${'b'.repeat(32)}`), null);
  // another server (another secret) does not honour it
  const B = makeAccounts({ query, secret: 'another', now: () => clock });
  assert.equal(B.readTicket(text), null);
});

await test('signing in: the number and the PIN; five wrong tries lock the account, for longer each time', async () => {
  const ok = await A.signIn(1, '4827');
  assert.ok(ok.ok && ok.account.name === 'Hana' && ok.token);
  assert.match((await A.signIn(999, '4827')).error, /No account/);
  assert.match((await A.signIn(1, 'abcd')).error, /No account/);
  for (let i = 4; i >= 1; i--) assert.match((await A.signIn(2, '0000')).error, new RegExp(`${i} more`));
  const locked = await A.signIn(2, '0000');
  assert.match(locked.error, /locked for 15 minutes/);
  assert.match((await A.signIn(2, '9053')).error, /locked for another 15 minutes/, 'the right PIN does not open a locked account');
  clock += 15 * 60 * 1000 + 1;
  for (let i = 0; i < 4; i++) await A.signIn(2, '0000');
  assert.match((await A.signIn(2, '0000')).error, /locked for 30 minutes/, 'twice as long the second time');
  clock += 30 * 60 * 1000 + 1;
  assert.ok((await A.signIn(2, '9053')).ok, 'and then the right PIN works again');
  for (let i = 0; i < 4; i++) await A.signIn(2, '0000');
  assert.match((await A.signIn(2, '0000')).error, /locked for 15 minutes/, 'getting in wipes the slate');
  clock += 16 * 60 * 1000;
  // someone else's account is not touched by any of that
  assert.ok((await A.signIn(1, '4827')).ok);
});

await test('a device stays signed in by its token; signing out ends it; a new PIN signs the other devices out', async () => {
  const a = await A.signIn(1, '4827');
  const b = await A.signIn(1, '4827');
  assert.equal((await A.resume(a.token)).id, 1);
  assert.equal(await A.resume('nonsense-nonsense-nonsense-x'), null);
  assert.equal(await A.resume(null), null);
  await A.signOut(a.token);
  assert.equal(await A.resume(a.token), null);
  assert.equal((await A.resume(b.token)).id, 1);
  const c = await A.signIn(1, '4827');
  assert.match((await A.setPin(1, '1111', c.token)).error, /first anyone would try/);
  assert.ok((await A.setPin(1, '6402', c.token)).ok);
  assert.equal(await A.resume(b.token), null, 'the other device is out');
  assert.equal((await A.resume(c.token)).id, 1, 'this one is not');
  assert.match((await A.signIn(1, '4827')).error, /not right/);
  assert.ok((await A.signIn(1, '6402')).ok);
  // no more than a handful of devices
  for (let i = 0; i < 12; i++) await A.signIn(1, '6402');
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM sessions WHERE account_id = 1')).rows[0].n), 8);
});

await test('rounds are counted in memory at once and written a moment later - again, if the database was away', async () => {
  const s = await A.signIn(2, '9053');
  const before = s.account.record.rounds;
  const rec = A.count(2, round(0), { slot: 0, theme: 'ink', arena: 'hills', duration: 60 });
  assert.deepEqual([rec.rounds, rec.wins, rec.styles.ink, rec.name], [before + 1, 1, 1, 'Kenji']);
  assert.equal(A.count(2, round(0, { reason: 'forfeit' }), { slot: 0 }).rounds, before + 1, 'a forfeit is not a round');
  assert.equal(A.count(77, round(0), { slot: 0 }), null, 'nobody signed in, nothing counted');
  assert.equal(A.cup(2, 'ko', true).cups.ko.won, 1);
  assert.equal(A.owed, 1);
  // the database is away: nothing is lost, and the game is not held up
  broken = true;
  await A.flush();
  assert.equal(A.owed, 1, 'still owed');
  A.count(2, round(0), { slot: 0, theme: 'ink', arena: 'hills', duration: 60 });
  broken = false;
  await A.flush();
  assert.equal(A.owed, 0);
  const stored = (await db.query('SELECT record FROM accounts WHERE id = 2')).rows[0].record;
  assert.deepEqual([stored.rounds, stored.wins, stored.cups.ko.won], [before + 2, 2, 1]);
  // let go of, and picked up again from the database
  await A.release(2);
  assert.equal(A.view(2), null);
  assert.equal((await A.resume(s.token)).record.rounds, before + 2);
});

await test('the name and the character are kept with the account', async () => {
  const s = await A.signIn(1, '6402');
  assert.ok((await A.saveProfile(1, { name: 'Hanako', look: { style: 'neon', colour: 12 } })).ok);
  await A.release(1);
  const again = await A.resume(s.token);
  assert.deepEqual([again.name, again.look, again.record.name, again.record.look], ['Hanako', { style: 'neon', colour: 9 }, 'Hanako', { style: 'neon', colour: 9 }]);
  assert.match((await A.saveProfile(55, { name: 'x' })).error, /Not signed in/);
});

await test('a forgotten PIN: a one-time code from the owner, good for a day, and every device is signed out', async () => {
  const old = await A.signIn(1, '6402');
  assert.match((await A.useReset(1, 'ABCDEF', '5120')).error, /No reset is waiting/);
  const made = await A.admin.reset(1);
  assert.ok(made.ok && /^[A-Z2-9]{6}$/.test(made.code) && made.expires - clock === 24 * 3600 * 1000);
  assert.ok(!JSON.stringify((await db.query('SELECT * FROM resets')).rows).includes(made.code), 'the code itself is not kept');
  assert.match((await A.useReset(1, 'WRONG1', '5120')).error, /not right/);
  assert.match((await A.useReset(1, made.code, '1234')).error, /first anyone would try/);
  const done = await A.useReset(1, ` ${made.code.toLowerCase()} `, '5120');
  assert.ok(done.ok && done.account.id === 1 && done.token);
  assert.equal(await A.resume(old.token), null);
  assert.ok((await A.signIn(1, '5120')).ok);
  assert.match((await A.useReset(1, made.code, '5121')).error, /No reset is waiting/, 'a code works once');
  // one that has run out
  const late = await A.admin.reset(1);
  clock += 25 * 3600 * 1000;
  assert.match((await A.useReset(1, late.code, '5121')).error, /run out/);
  // guessing codes locks the account like guessing PINs does
  const g = await A.admin.reset(2);
  for (let i = 0; i < 4; i++) await A.useReset(2, 'AAAAAA', '5121');
  assert.match((await A.useReset(2, 'AAAAAA', '5121')).error, /locked/);
  assert.match((await A.useReset(2, g.code, '5121')).error, /locked/);
  clock += 16 * 60 * 1000;
  assert.ok((await A.useReset(2, g.code, '5121')).ok);
});

await test('the owner: an overview, closing and opening an account, deleting one, stopping new accounts', async () => {
  const o = await A.admin.overview();
  assert.equal(o.total, 3);
  assert.deepEqual(o.accounts.map((x) => x.id), [3, 2, 1]);
  assert.ok(o.log.some((l) => l.action === 'reset' && l.id === 1));
  const s = await A.signIn(3, '3310');
  await A.admin.ban(3, true);
  assert.equal(await A.resume(s.token), null);
  assert.match((await A.signIn(3, '3310')).error, /closed/);
  await A.admin.ban(3, false);
  assert.ok((await A.signIn(3, '3310')).ok);
  assert.ok((await A.admin.remove(3)).ok);
  assert.match((await A.signIn(3, '3310')).error, /No account/);
  assert.equal((await A.admin.find(3)), null);
  assert.match((await A.admin.reset(3)).error, /No such/);
  await A.admin.pause(true);
  assert.match((await A.create({ pin: '8842', name: 'Sora', played: played(3) })).error, /switched off/);
  // (and it is remembered across a restart)
  const C = makeAccounts({ query, secret: 'test-secret', now: () => clock });
  await C.init();
  assert.equal(C.paused, true);
  await A.admin.pause(false);
  const next = await A.create({ pin: '8842', name: 'Sora', played: played(3) });
  assert.equal(next.account.id, 4, 'a number that has been used is not given out again');
});

await test('no more than so many new accounts in an hour, whoever asks; an account can be deleted by its owner', async () => {
  clock += 2 * 3600 * 1000;
  let made = 0;
  let refused = '';
  for (let i = 0; i < 9; i++) {
    const r = await A.create({ pin: '8842', name: `P${i}`, played: played(3) });
    if (r.ok) made++;
    else refused = r.error;
  }
  assert.equal(made, 6);
  assert.match(refused, /lot of accounts have just been made/);
  clock += 3600 * 1000 + 1;
  const last = await A.create({ pin: '8842', name: 'Late', played: played(3) });
  assert.ok(last.ok);
  assert.match((await A.remove(last.account.id, '0001')).error, /not right/);
  assert.ok((await A.remove(last.account.id, '8842')).ok);
  assert.equal(await A.resume(last.token), null);
});

await test('friends: one asks, the other answers; a no is never told; both lists, the card anybody may see, and the limits', async () => {
  clock += 2 * 3600 * 1000;
  const mk = async (name) => (await A.create({ pin: '8842', name, played: played(3) })).account.id;
  const [x, y, z] = [await mk('Xia'), await mk('Yuki'), await mk('Zed')];
  const names = (list) => list.map((p) => p.name).join(',');
  // asking: not yourself, not nobody
  assert.match((await A.friends.ask(x, x)).error, /your own number/);
  assert.match((await A.friends.ask(x, 99999)).error, /no player #99999/);
  assert.match((await A.friends.ask(x, 1.5)).error, /player number/);
  const asked = await A.friends.ask(x, y);
  assert.deepEqual([asked.ok, asked.state, asked.news, asked.name], [true, 'asked', true, 'Yuki']);
  assert.equal((await A.friends.ask(x, y)).news, undefined, 'asked twice: told once');
  let lx = await A.friends.list(x);
  let ly = await A.friends.list(y);
  assert.deepEqual([names(lx.friends), names(lx.incoming), names(lx.outgoing)], ['', '', 'Yuki']);
  assert.deepEqual([names(ly.friends), names(ly.incoming), names(ly.outgoing)], ['', 'Xia', '']);
  assert.deepEqual(ly.incoming[0], { id: x, name: 'Xia', look: ['ink', 0] });
  assert.equal(await A.friends.are(x, y), false);
  // the card anybody may see: who they are and a few numbers - and what the two are to each other
  assert.deepEqual((await A.card(y, x)).card.state, 'asked');
  assert.deepEqual((await A.card(x, y)).card.state, 'incoming');
  assert.deepEqual((await A.card(x, x)).card.state, 'me');
  const card = (await A.card(x, 0)).card;
  assert.deepEqual([card.id, card.name, card.look, card.rounds, card.wins, card.best, card.cups, card.state], [x, 'Xia', ['ink', 0], 0, 0, 0, 0, 'none']);
  assert.ok(card.since > 0 && !('record' in card) && !JSON.stringify(card).includes('pin'));
  assert.match((await A.card(99999, x)).error, /No such player/);
  // yes
  assert.match((await A.friends.answer(x, y, true)).error, /no longer there/, 'only whoever was asked can answer');
  const yes = await A.friends.answer(y, x, true);
  assert.deepEqual([yes.ok, yes.state, yes.news], [true, 'friends', true]);
  assert.ok((await A.friends.are(x, y)) && (await A.friends.are(y, x)));
  assert.deepEqual(await A.friends.ids(x), [y]);
  assert.equal((await A.card(y, x)).card.state, 'friends');
  assert.deepEqual((await A.friends.ask(y, x)).state, 'friends');
  // asking someone who has asked you is a yes
  await A.friends.ask(z, x);
  const back = await A.friends.ask(x, z);
  assert.deepEqual([back.state, back.news], ['friends', true]);
  lx = await A.friends.list(x);
  assert.deepEqual([names(lx.friends), names(lx.incoming), names(lx.outgoing)], ['Yuki,Zed', '', '']);
  assert.deepEqual(await A.friends.count(x), { friends: 2, asked: 0, waiting: 0 });
  // no longer friends: gone from both lists
  const gone = await A.friends.remove(x, z);
  assert.deepEqual([gone.ok, gone.state, gone.news], [true, 'none', true]);
  assert.equal(names((await A.friends.list(z)).friends), '');
  // a no: whoever asked is not told, and cannot ask again for a week
  await A.friends.ask(z, y);
  const no = await A.friends.answer(y, z, false);
  assert.deepEqual([no.ok, no.state, no.news], [true, 'none', false]);
  assert.equal(names((await A.friends.list(y)).incoming), '', 'gone from the list of whoever said no');
  assert.equal(names((await A.friends.list(z)).outgoing), 'Yuki', 'still "asked" to whoever asked');
  assert.equal((await A.card(y, z)).card.state, 'asked');
  assert.equal((await A.card(z, y)).card.state, 'none');
  const again = await A.friends.ask(z, y);
  assert.deepEqual([again.state, again.news], ['asked', undefined], 'asking again: nothing is sent');
  assert.equal(names((await A.friends.list(y)).incoming), '');
  // taking it back hides it - and does not clear the way
  await A.friends.remove(z, y);
  assert.equal(names((await A.friends.list(z)).outgoing), '');
  assert.equal((await A.friends.ask(z, y)).news, undefined);
  assert.equal(names((await A.friends.list(y)).incoming), '');
  clock += 8 * 24 * 3600 * 1000;
  assert.equal((await A.friends.ask(z, y)).news, true, 'a week on, it can be asked again');
  assert.equal(names((await A.friends.list(y)).incoming), 'Zed');
  // whoever said no can change their mind by asking themselves
  await A.friends.answer(y, z, false);
  assert.deepEqual((await A.friends.ask(y, z)).state, 'friends');
  await A.friends.remove(y, z);
  // a request of your own can be taken back before it is answered
  await A.friends.ask(z, x);
  assert.equal(names((await A.friends.list(x)).incoming), 'Zed');
  await A.friends.remove(z, x);
  assert.equal(names((await A.friends.list(x)).incoming), '');
  assert.equal((await A.friends.ask(z, x)).news, true);
  // "remove" on a request that is waiting for YOU is a no
  assert.equal((await A.friends.remove(x, z)).state, 'none');
  assert.equal(names((await A.friends.list(z)).outgoing), 'Xia', 'which, again, whoever asked is not told');
  // an account that is closed or deleted is in nobody's list
  await A.admin.ban(y, true);
  assert.equal(names((await A.friends.list(x)).friends), '');
  assert.match((await A.friends.ask(z, y)).error, /no player/);
  await A.admin.ban(y, false);
  assert.equal(names((await A.friends.list(x)).friends), 'Yuki');
  await A.admin.remove(y);
  assert.equal(names((await A.friends.list(x)).friends), '');
  assert.deepEqual(await A.friends.ids(x), []);
  // the limits: only so many requests out, unanswered, at once
  const B = makeAccounts({ query, secret: 'test-secret', perHour: 1000, now: () => clock, log: () => {} });
  const crowd = [];
  for (let i = 0; i < 21; i++) crowd.push((await B.create({ pin: '8842', name: `Q${i}`, played: played(3) })).account.id);
  for (const id of crowd.slice(0, 19)) assert.ok((await B.friends.ask(z, id)).ok); // (one is out already: to Xia)
  assert.deepEqual(await B.friends.count(z), { friends: 0, asked: 20, waiting: 0 });
  assert.match((await B.friends.ask(z, crowd[19])).error, /waiting for an answer/);
  assert.ok((await B.friends.answer(crowd[0], z, true)).ok);
  assert.ok((await B.friends.ask(z, crowd[19])).ok, 'one answered: room for one more');
});

console.log(`accounts: ${passed} tests passed`);
