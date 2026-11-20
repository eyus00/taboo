// Your account, as the browser sees it. Nobody needs one: without it the record stays in
// this browser (profile.js). With one, the server keeps the record (and counts it - see
// /accounts.js at the top of the project) under a number of your own, and a PIN of four
// digits lets you in from another device.
//
// What is kept here: the token that keeps this device signed in, and the ticket that says
// how many rounds this browser has played (three make an account possible). Never the PIN.
//
//   account.init({ socket, onChange(state), onRecord(record), onOut() })
//   account.state -> { on, need, played, open, me: null | { id, name, look } }
//   account.create(pin, { name, look, record })   signIn(id, pin)   reset(id, code, pin)
//   account.setPin(pin)   signOut(everywhere)   remove(pin)   save({ name, look })
//       each -> Promise<{ ok: true, ... } | { error }>

const TOKEN = 'tag.acct';
const TICKET = 'tag.ticket';
const get = (k) => {
  try {
    return localStorage.getItem(k) || '';
  } catch {
    return '';
  }
};
const set = (k, v) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {}
};

let socket = null;
let opts = {};
const state = { on: false, need: 3, played: 0, open: true, me: null };
const changed = () => opts.onChange?.(state);

const call = (event, msg = {}) =>
  new Promise((resolve) => {
    if (!socket?.connected) return resolve({ error: 'Not connected. Try again in a moment.' });
    socket.timeout(15000).emit(event, msg, (err, res) => resolve(err || !res ? { error: 'The server did not answer. Try again in a moment.' } : res));
  });

// signed in: remember the device's token, and take the account's record as ours
function enter(res) {
  if (!res?.ok || !res.account) return res;
  set(TOKEN, res.token);
  state.me = { id: res.account.id, name: res.account.name, look: res.account.look };
  opts.onRecord?.(res.account.record, res.account);
  changed();
  return res;
}
function leave(told = false) {
  set(TOKEN, '');
  const was = state.me;
  state.me = null;
  if (was && told) opts.onOut?.();
  changed();
}

// every time the connection comes up: say who we are (the token) and what we have played (the ticket)
async function hello() {
  const res = await call('acct:hello', { token: get(TOKEN), ticket: get(TICKET) });
  state.on = !!res.on;
  if (!res.on) {
    state.me = null;
    return changed();
  }
  state.need = res.need;
  state.played = res.played;
  state.open = res.open !== false;
  if (res.account) {
    state.me = { id: res.account.id, name: res.account.name, look: res.account.look };
    opts.onRecord?.(res.account.record, res.account);
  } else {
    if (res.gone) set(TOKEN, ''); // (signed out from somewhere else, or the account is no more)
    state.me = null;
  }
  changed();
}

export const account = {
  state,
  init(o) {
    opts = o || {};
    socket = o.socket;
    socket.on('connect', hello);
    if (socket.connected) hello();
    // after a round: one more on the ticket - and, with an account, the record as the server has it now
    socket.on('acct', (m) => {
      if (!m) return;
      if (m.ticket) {
        set(TICKET, m.ticket);
        state.played = m.played;
      }
      if (m.record && state.me) opts.onRecord?.(m.record, null);
      if (m.out) return leave(true);
      changed();
    });
  },
  create: (pin, { name, look, record }) => call('acct:create', { pin, name, look: [look.style, look.colour], record }).then(enter),
  signIn: (id, pin) => call('acct:signin', { id, pin }).then(enter),
  reset: (id, code, pin) => call('acct:reset', { id, code, pin }).then(enter),
  setPin: (pin) => call('acct:pin', { pin }),
  save: ({ name, look }) => (state.me ? call('acct:save', { name, look: [look.style, look.colour] }) : Promise.resolve({ ok: true })),
  async signOut(everywhere = false) {
    const res = await call('acct:signout', { everywhere });
    if (res.ok) leave();
    return res;
  },
  async remove(pin) {
    const res = await call('acct:delete', { pin });
    if (res.ok) leave();
    return res;
  },
};
