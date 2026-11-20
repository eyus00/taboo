// Friends, as the browser sees them. They go with an account (account.js): two players who
// each have a number can be friends - one asks, the other says yes - and from then on each
// sees when the other is about and where, and can ask them into a room.
//
// The server is the only memory (see the notes above `circles` in /server.js): this file
// asks for the lists, keeps what it was last sent, and asks again whenever it is told
// something changed. Invitations are not kept anywhere: they are shown while they are fresh.
//
//   friends.init({ socket, onChange(state), onNews(news), onInvite(invite) })
//   friends.state -> { ready, me, friends: [{ id, name, look, online, room }], incoming, outgoing, invites }
//       room: null | { here, open, code, playing, full }     invites: [{ from, code, playing, at }]
//   friends.refresh()   friends.reset()   (signed out: nothing is known any more)
//   friends.add(id)  answer(id, yes)  remove(id)  invite(id)  card(id)   each -> Promise<{ ok, ... } | { error }>
//   friends.waiting   how many things want an answer (requests, invitations)

const INVITE_MS = 120000; // an invitation is offered for this long

let socket = null;
let opts = {};
let asked = 0;
const state = { ready: false, me: 0, friends: [], incoming: [], outgoing: [], invites: [] };
const changed = () => opts.onChange?.(state);

const call = (event, msg = {}) =>
  new Promise((resolve) => {
    if (!socket?.connected) return resolve({ error: 'Not connected. Try again in a moment.' });
    socket.timeout(12000).emit(event, msg, (err, res) => resolve(err || !res ? { error: 'The server did not answer. Try again in a moment.' } : res));
  });
const fresh = () => {
  const before = state.invites.length;
  state.invites = state.invites.filter((v) => Date.now() - v.got < INVITE_MS);
  return state.invites.length !== before;
};

export const friends = {
  state,
  init(o) {
    opts = o || {};
    socket = o.socket;
    // something between me and somebody changed, or a friend came or went: the lists are read again
    socket.on('friend:news', (news) => {
      if (!news) return;
      opts.onNews?.(news);
      this.refresh();
    });
    // "come and play": kept while it is fresh (one from each friend: the newest)
    socket.on('invite', (v) => {
      if (!v?.from?.id || !v.code) return;
      state.invites = [...state.invites.filter((x) => x.from.id !== v.from.id), { ...v, got: Date.now() }];
      fresh();
      opts.onInvite?.(v);
      changed();
    });
    socket.on('disconnect', () => {
      state.ready = false;
    });
    setInterval(() => fresh() && changed(), 5000);
  },
  get waiting() {
    return state.incoming.length + state.invites.length;
  },
  async refresh() {
    const my = ++asked;
    const res = await call('friend:list');
    if (my !== asked) return res;
    if (res.ok) {
      state.ready = true;
      state.me = res.me;
      // (whoever is about first, then by name - which is how the server sent them)
      state.friends = res.friends.slice().sort((a, b) => Number(b.online) - Number(a.online));
      state.incoming = res.incoming;
      state.outgoing = res.outgoing;
    } else if (res.needAccount || res.off) this.reset(true);
    changed();
    return res;
  },
  reset(quiet = false) {
    asked++;
    Object.assign(state, { ready: false, me: 0, friends: [], incoming: [], outgoing: [], invites: [] });
    if (!quiet) changed();
  },
  async add(id) {
    const res = await call('friend:add', { id });
    if (res.ok) await this.refresh();
    return res;
  },
  async answer(id, yes) {
    const res = await call('friend:answer', { id, yes: !!yes });
    await this.refresh();
    return res;
  },
  async remove(id) {
    const res = await call('friend:remove', { id });
    await this.refresh();
    return res;
  },
  invite: (id) => call('invite:send', { id }),
  card: (id) => call('player:card', { id }),
  // an invitation has been taken up, or waved away
  dropInvite(fromId) {
    state.invites = state.invites.filter((v) => v.from.id !== fromId);
    changed();
  },
};
