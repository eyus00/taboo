// Chat, everywhere: a bookmark on the right edge of the screen (or "/") opens a small scroll
// with two channels - the room you are in, and everyone who is connected - and a third leaf
// for your friends (friends.js): who is about, who has asked, who invites you to a room.
// It is there in the menus and in a match alike; and whatever is said shows up for a few
// seconds in the corner of the screen as it is said, so nobody has to keep the scroll open
// to follow. Tab, in the box, turns to the next leaf.
//
// The server is the only memory (see /chat.js at the top of the project): this file keeps
// what it has been sent while the page is open, and asks again whenever it reconnects or
// changes rooms. Nothing is stored in the browser but the list of people you have muted,
// and that only for this visit (their ids change with every connection anyway).
//
// A message is plain text from end to end: it is only ever set as textContent.
//
//   chat.init({ socket, sfx, name(): string, askName(then), look(): { style, colour },
//               avatar(look, size): Promise<url>, onOpen(), inGame(): boolean,
//               friends, account(): account.state, onPerson(who), onAccount(), onJoin(invite) })
//       onPerson: someone's name was chosen - who = { no, name, look, from } (no: their account's number, if any)
//   chat.sync({ room, hidden })   room: the code of the room we are in, or ''; hidden: no chat here at all (no name yet)
//   chat.toggle(open?)  chat.close()  chat.isOpen   chat.show(tab)   chat.people() (the friends changed: paint them)
//   chat.invited(invite)   chat.isMuted(from)  chat.mute(from, on)
//
// Typing in the box never reaches the game or the menus' shortcuts (the box stops its own
// key events; a match is told the keys are not its own while the scroll is open - onOpen),
// and Esc closes the chat rather than whatever is behind it. In a match the scroll shuts
// again as soon as you have said your piece.

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const COLORS = ['#c8372d', '#2f62b0', '#3c8f57', '#d79a12', '#7a4a9e', '#d9689a', '#d2691e', '#2a8f8f', '#7a5230', '#7c8088']; // the house style's ten
const hueOf = (id) => {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};
const clock = (at) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const BUBBLE = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.500h16a1.500 1.500 0 0 1 1.500 1.500v9.500a1.500 1.500 0 0 1-1.500 1.500h-8l-5 3.800v-3.800H4a1.500 1.500 0 0 1-1.500-1.500V6A1.500 1.500 0 0 1 4 4.500z" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linejoin="round"/><path d="M7.500 9.200h9M7.500 12.600h5.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const NOTES = {
  all: 'Everyone who is online reads this. Keep it friendly, and keep personal details to yourself.',
  room: 'Only the people in this room read this.',
  friends: '',
};
const PEOPLE_MS = 8000; // while the friends are on show, who is about is asked this often
const TABS = ['room', 'all', 'friends'];
const FEED_MS = 7000; // how long a message stays in the corner of the screen
const FEED_MAX = 4; // and how many at once
const GROUP_MS = 90000; // messages from one person this close together share one heading

let opts = {};
let socket = null;
let ui = null;
let open = false;
let visible = false;
let room = '';
let tab = 'all';
let me = '';
let epoch = 0;
let max = 140;
let global = true;
let asked = 0; // (guards against answers to an older question)
const logs = { all: [], room: [] };
const unread = { all: 0, room: 0 };
let muted = new Set();
try {
  muted = new Set(JSON.parse(sessionStorage.getItem('tag.muted') || '[]'));
} catch {}
const saveMuted = () => {
  try {
    sessionStorage.setItem('tag.muted', JSON.stringify([...muted]));
  } catch {}
};

function build() {
  const tabBtn = el('button', 'chat-tab');
  tabBtn.type = 'button';
  tabBtn.id = 'chat-tab';
  tabBtn.setAttribute('aria-controls', 'chat');
  tabBtn.setAttribute('aria-expanded', 'false');
  tabBtn.innerHTML = `${BUBBLE}<span>Chat</span><kbd>/</kbd><b class="chat-badge" hidden></b>`;
  tabBtn.hidden = true;

  const box = el('aside', 'chat');
  box.id = 'chat';
  box.hidden = true;
  box.setAttribute('aria-label', 'Chat');
  const head = el('header');
  const tabs = el('div', 'chat-tabs');
  tabs.setAttribute('role', 'tablist');
  const mk = (to, text) => {
    const b = el('button', 'chat-ch');
    b.type = 'button';
    b.dataset.to = to;
    b.setAttribute('role', 'tab');
    b.append(el('span', '', text), el('b', 'chat-badge'));
    b.lastChild.hidden = true;
    b.addEventListener('click', () => {
      opts.sfx?.play('click');
      setTab(to);
      land();
    });
    tabs.append(b);
    return b;
  };
  const chRoom = mk('room', 'Room');
  const chAll = mk('all', 'Everyone');
  const chFriends = mk('friends', 'Friends');
  // (the key that turns to the next of them)
  const cue = el('span', 'chat-cue');
  cue.innerHTML = '<kbd>Tab</kbd>';
  cue.title = 'Tab turns to the next one';
  tabs.append(cue);
  const x = el('button', 'chat-x');
  x.type = 'button';
  x.setAttribute('aria-label', 'Close chat');
  x.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/></svg>';
  head.append(tabs, x);
  const list = el('ol', 'chat-list');
  list.setAttribute('aria-live', 'polite');
  const note = el('p', 'chat-note');
  const form = el('form', 'chat-form');
  const input = el('input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  input.setAttribute('aria-label', 'Your message');
  input.placeholder = 'Say something…';
  const send = el('button', 'chat-send', 'Send');
  send.type = 'submit';
  form.append(input, send);
  // the friends' leaf: the people, and a box for the number of someone to add
  const people = el('div', 'chat-people');
  people.hidden = true;
  const addForm = el('form', 'chat-form chat-add');
  addForm.hidden = true;
  const addInput = el('input');
  addInput.type = 'text';
  addInput.inputMode = 'numeric';
  addInput.autocomplete = 'off';
  addInput.maxLength = 11;
  addInput.enterKeyHint = 'done';
  addInput.setAttribute('aria-label', 'The number of a player to add as a friend');
  addInput.placeholder = 'A player number, like 12';
  const addBtn = el('button', 'chat-send', 'Add');
  addBtn.type = 'submit';
  addForm.append(el('span', 'chat-hash', '#'), addInput, addBtn);
  box.append(head, list, people, note, form, addForm);
  // what is being said, as it is said: a few lines in the corner, gone again in a moment
  const feed = el('ol', 'chat-feed');
  feed.setAttribute('aria-hidden', 'true');
  document.body.append(tabBtn, box, feed);

  tabBtn.addEventListener('click', () => {
    opts.sfx?.play('click');
    chat.toggle(true);
  });
  x.addEventListener('click', () => {
    opts.sfx?.play('click');
    chat.close();
  });
  // nothing typed here is anybody else's business: not the menus' shortcuts, not the room code
  for (const field of [input, addInput]) {
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        chat.close();
      } else if (turns(e)) turn(e);
    });
    for (const type of ['keyup', 'keypress']) field.addEventListener(type, (e) => e.stopPropagation());
  }
  // (Esc anywhere else in the scroll - on one of its buttons, say - closes it too, and nothing behind it;
  // and Tab on a leaf's own name turns to the next, as it does in the box)
  box.addEventListener('keydown', (e) => {
    if (turns(e) && e.target.closest?.('.chat-ch')) return turn(e);
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    chat.close();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    say();
  });
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addFriend();
  });
  ui = { tabBtn, box, list, note, form, input, send, chRoom, chAll, chFriends, cue, people, addForm, addInput, addBtn, feed, badge: tabBtn.querySelector('.chat-badge') };
}

// the leaves there are to turn to, in order
const friendsOn = () => !!opts.friends && !!opts.account?.().on;
const shown = () => TABS.filter((t) => (t === 'room' ? !!room : t === 'all' ? global : friendsOn()));
// Tab, in the box: the next leaf (Shift+Tab still walks back through the buttons, as anywhere)
const turns = (e) => e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && shown().length > 1;
function turn(e) {
  e.preventDefault();
  e.stopPropagation();
  opts.sfx?.play('click');
  const all = shown();
  setTab(all[(all.indexOf(tab) + 1) % all.length]);
  land();
}
// where the keys go on the leaf that is open: its box - or, where it has none, its own name
function land() {
  if (tab !== 'friends') ui.input.focus();
  else if (!ui.addForm.hidden) ui.addInput.focus();
  else ui.chFriends.focus();
}

// --- what is shown ------------------------------------------------------------------------
// whoever said it: their initial on their colour - and, a moment later, the character they chose
function sealOf(m) {
  const seal = el('i', 'chat-seal', (m.name || '?').trim().charAt(0).toUpperCase());
  seal.style.setProperty('--c', hueOf(m.from));
  if (Array.isArray(m.look) && opts.avatar) {
    Promise.resolve(opts.avatar({ style: m.look[0], colour: m.look[1] }, 48)).then((url) => {
      if (!url) return;
      seal.textContent = '';
      seal.classList.add('pic');
      seal.style.backgroundImage = `url("${url}")`;
    }).catch(() => {});
  }
  return seal;
}
// a line in the corner of the screen
function pop(m) {
  if (!ui || !visible || m.sys) return;
  const li = el('li', m.to === 'room' ? 'room' : 'all');
  const text = el('p');
  text.append(el('b', '', m.name), el('span', '', m.text));
  li.append(sealOf(m), text);
  if (m.to === 'all' && room) li.append(el('small', '', 'All')); // (in a room, say which channel that came from)
  ui.feed.append(li);
  while (ui.feed.childElementCount > FEED_MAX) ui.feed.firstElementChild.remove();
  setTimeout(() => li.classList.add('going'), FEED_MS - 400);
  setTimeout(() => li.remove(), FEED_MS);
}
// "come and play", as it arrives: a line in the corner, with the way in (in a match: where to find it)
function popInvite(v) {
  if (!ui || !visible) return;
  const li = el('li', 'room invite');
  const text = el('p');
  text.append(el('b', '', v.from.name), el('span', '', 'invites you to their room'));
  li.append(sealOf({ name: v.from.name, from: `#${v.from.id}`, look: v.from.look }), text);
  if (opts.inGame?.()) text.append(el('em', '', ' \u00b7 open Friends to join'));
  else {
    const join = el('button', 'chat-act go', 'Join');
    join.type = 'button';
    join.addEventListener('click', () => {
      li.remove();
      opts.onJoin?.(v);
    });
    li.append(join);
  }
  ui.feed.append(li);
  while (ui.feed.childElementCount > FEED_MAX) ui.feed.firstElementChild.remove();
  setTimeout(() => li.classList.add('going'), 14600);
  setTimeout(() => li.remove(), 15000);
}
function item(m, prev) {
  if (m.sys) return el('li', 'chat-sys', m.text);
  const li = el('li', m.from === me ? 'chat-msg mine' : 'chat-msg');
  li.dataset.from = m.from;
  const joined = prev && !prev.sys && prev.from === m.from && prev.name === m.name && m.at - prev.at < GROUP_MS;
  if (!joined) {
    const head = el('div', 'chat-who');
    // (who said it: choose them, and their card opens)
    const who = el('button', 'chat-name');
    who.type = 'button';
    who.title = m.from === me ? 'Your profile' : `Who is ${m.name}?`;
    who.append(sealOf(m), el('b', '', m.name));
    if (m.no) who.append(el('small', 'chat-no', `#${m.no}`)); // (their account's number, if they have one)
    who.addEventListener('click', () => {
      opts.sfx?.play('click');
      opts.onPerson?.({ no: m.no || 0, name: m.name, look: m.look, from: m.from, me: m.from === me });
    });
    head.append(who, el('time', '', clock(m.at)));
    if (m.from !== me) {
      const mute = el('button', 'chat-mute', 'Mute');
      mute.type = 'button';
      mute.title = `Hide what ${m.name} says, for as long as this page is open`;
      mute.addEventListener('click', () => {
        muted.add(m.from);
        saveMuted();
        paint();
        setNote(`${m.name} is muted.`, 'Undo', () => {
          muted.delete(m.from);
          saveMuted();
          paint();
          setNote('');
        });
      });
      head.append(mute);
    }
    li.append(head);
  } else li.classList.add('joined');
  li.append(el('p', '', m.text));
  return li;
}

// --- the friends' leaf ----------------------------------------------------------------------
// One person in a list: their character, name and number (choose them: their card), a line
// about them, and what can be done.   acts: [[label, run, kind]]
function person(p, sub, acts) {
  const li = el('li', p.online ? 'chat-person on' : 'chat-person');
  const who = el('button', 'chat-name');
  who.type = 'button';
  who.title = `Who is ${p.name}?`;
  who.append(sealOf({ name: p.name, from: `#${p.id}`, look: p.look }), el('b', '', p.name), el('small', 'chat-no', `#${p.id}`));
  who.addEventListener('click', () => {
    opts.sfx?.play('click');
    opts.onPerson?.({ no: p.id, name: p.name, look: p.look });
  });
  const main = el('div', 'chat-pmain');
  main.append(who);
  if (sub) main.append(el('span', 'chat-sub', sub));
  const btns = el('div', 'chat-acts');
  for (const [label, run, kind] of acts) {
    const b = el('button', kind ? `chat-act ${kind}` : 'chat-act', label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      opts.sfx?.play('click');
      b.disabled = true;
      const res = await run();
      if (b.isConnected) b.disabled = false;
      if (res?.error) setNote(res.error);
      else if (res?.say) setNote(res.say, '', null, false);
    });
    btns.append(b);
  }
  li.append(main, btns);
  return li;
}
const whereIs = (f) => (!f.online ? 'Not here now' : f.room?.here ? 'In this room' : f.room ? `In a ${f.room.open ? '' : 'private '}room${f.room.playing ? ', playing' : ''}` : 'Online');
let peopleKey = '';
function paintPeople() {
  if (!ui) return;
  const box = ui.people;
  const acct = opts.account?.() || {};
  const F = opts.friends;
  // (nothing new: what is there stays as it is - and so does whatever in it has the focus)
  const key = JSON.stringify([acct.me?.id || 0, acct.need, acct.played, room, F.state.ready, F.state.friends, F.state.incoming, F.state.outgoing, F.state.invites.map((v) => [v.from.id, v.code])]);
  if (key === peopleKey && box.childElementCount) return;
  peopleKey = key;
  const keep = box.scrollTop;
  box.textContent = '';
  const say = (text, action, run) => {
    const p = el('p', 'chat-empty', text);
    box.append(p);
    if (action) {
      const b = el('button', 'chat-act go', action);
      b.type = 'button';
      b.addEventListener('click', run);
      box.append(b);
    }
  };
  ui.addForm.hidden = !acct.me;
  if (!acct.me) {
    // friends go with an account: say so, and offer the way to one
    const left = Math.max(0, (acct.need || 0) - (acct.played || 0));
    if (left > 0) say(`Friends go with an account - a number of your own. Play ${left} more round${left === 1 ? '' : 's'} and you can make one.`, 'Sign in instead', () => opts.onAccount?.('signin'));
    else say('Friends go with an account - a number of your own that others can add.', 'Make an account', () => opts.onAccount?.('create'));
    return;
  }
  const st = F.state;
  if (!st.ready) return say('Looking for your friends…');
  const section = (title, list, row) => {
    if (!list.length) return;
    box.append(el('h3', 'chat-h', title));
    const ul = el('ul', 'chat-plist');
    for (const x of list) ul.append(row(x));
    box.append(ul);
  };
  section('Invitations', st.invites, (v) =>
    person({ ...v.from, online: true }, v.playing ? 'Invites you to their room (a match is on: you play the next round)' : 'Invites you to their room', [
      ['Join', () => opts.onJoin?.(v), 'go'],
      ['Not now', () => F.dropInvite(v.from.id)],
    ]),
  );
  section('Want to be friends', st.incoming, (p) =>
    person({ ...p, online: false }, '', [
      ['Yes', () => F.answer(p.id, true), 'go'],
      ['No', () => F.answer(p.id, false)],
    ]),
  );
  const here = st.friends.filter((f) => f.online).length;
  section(st.friends.length ? `Friends \u00b7 ${here} here` : '', st.friends, (f) => {
    const acts = [];
    if (room && f.online && !f.room?.here) acts.push(['Invite', async () => {
      const res = await F.invite(f.id);
      return res.ok ? { say: `${f.name} has been invited.` } : res;
    }, 'go']);
    if (f.room && !f.room.here && f.room.code && !f.room.full) acts.push(['Join', () => opts.onJoin?.({ from: f, code: f.room.code, playing: f.room.playing }), room ? '' : 'go']);
    return person(f, whereIs(f), acts);
  });
  section('Asked', st.outgoing, (p) => person({ ...p, online: false }, 'Has not answered yet', [['Take back', () => F.remove(p.id)]]));
  if (!st.friends.length && !st.incoming.length && !st.outgoing.length && !st.invites.length) say('No friends yet. Everyone with an account has a number - it is beside their name in chat, like #12. Add someone by theirs below, or choose their name in chat.');
  box.scrollTop = keep;
}
async function addFriend() {
  const id = Number(ui.addInput.value.replace(/[^0-9]/g, ''));
  if (!id) return setNote('Type the number of the player to add.');
  ui.addBtn.disabled = true;
  const res = await opts.friends.add(id);
  ui.addBtn.disabled = false;
  if (res.error) return setNote(res.error);
  ui.addInput.value = '';
  setNote(res.state === 'friends' ? `You and ${res.name} are friends.` : `${res.name} has been asked. They see it the next time they are here.`, '', null, false);
}
// (while the friends are on show: who is about, every few seconds)
let peopleTimer = 0;
function watchPeople() {
  const want = open && tab === 'friends' && !!opts.account?.().me;
  if (want === !!peopleTimer) return;
  clearInterval(peopleTimer);
  peopleTimer = 0;
  if (!want) return;
  opts.friends.refresh();
  peopleTimer = setInterval(() => opts.friends.refresh(), PEOPLE_MS);
}

function paint() {
  if (!ui) return;
  if (tab === 'friends') return paintPeople();
  const list = logs[tab].filter((m) => m.sys || !muted.has(m.from));
  ui.list.textContent = '';
  if (!list.length) ui.list.append(el('li', 'chat-empty', tab === 'room' ? 'Nothing said in this room yet.' : 'Nothing said yet. Say hello!'));
  let prev = null;
  for (const m of list) {
    ui.list.append(item(m, prev));
    prev = m;
  }
  ui.list.scrollTop = ui.list.scrollHeight;
}

function setNote(text, action = '', run = null, warn = true) {
  if (!ui) return;
  const me = opts.account?.().me;
  ui.note.textContent = text || (tab === 'friends' ? (me ? `Your number is #${me.id}. Friends add each other by number.` : '') : NOTES[tab]);
  ui.note.classList.toggle('warn', !!text && !action && warn);
  if (action) {
    const b = el('button', 'chat-link', action);
    b.type = 'button';
    b.addEventListener('click', run);
    ui.note.append(' ', b);
  }
}

function badges() {
  if (!ui) return;
  const show = (b, n, dot) => {
    b.hidden = !n;
    b.textContent = dot || !n ? '' : n > 9 ? '9+' : String(n);
    b.classList.toggle('dot', !!dot);
  };
  show(ui.chRoom.querySelector('.chat-badge'), unread.room);
  show(ui.chAll.querySelector('.chat-badge'), unread.all, true); // (the channel for everyone only says that there is something new)
  // (friends: requests and invitations that want an answer)
  const waiting = friendsOn() && opts.account?.().me ? opts.friends.waiting : 0;
  show(ui.chFriends.querySelector('.chat-badge'), waiting);
  // on the bookmark: how much is waiting in the room and from friends - or, failing that, a dot for the rest
  show(ui.badge, unread.room + waiting || unread.all, !(unread.room + waiting));
}

function setTab(to) {
  if (to === 'friends' && !friendsOn()) to = room ? 'room' : 'all';
  if (to === 'room' && !room) to = 'all';
  if (to === 'all' && !global) to = room ? 'room' : 'all';
  tab = to;
  if (!ui) return;
  ui.chRoom.hidden = !room;
  ui.chAll.hidden = !global;
  ui.chFriends.hidden = !friendsOn();
  ui.cue.hidden = shown().length < 2;
  for (const b of [ui.chRoom, ui.chAll, ui.chFriends]) b.setAttribute('aria-selected', String(b.dataset.to === tab));
  const people = tab === 'friends';
  ui.list.hidden = people;
  ui.form.hidden = people;
  ui.people.hidden = !people;
  ui.addForm.hidden = !people || !opts.account?.().me;
  watchPeople();
  if (people) {
    setNote('');
    paint();
    return badges();
  }
  if (open) unread[tab] = 0;
  ui.input.maxLength = max;
  ui.input.placeholder = tab === 'room' ? 'Say something to the room…' : 'Say something to everyone…';
  const off = tab === 'all' && !global;
  ui.input.disabled = off;
  ui.send.disabled = off;
  setNote(off ? 'This chat is switched off here.' : '');
  paint();
  badges();
}

// --- talking to the server ------------------------------------------------------------------
// Ask for what has been said (in the room we are in, and by everyone), and to be told from now on.
function ask() {
  if (!socket?.connected) return;
  const my = ++asked;
  socket.emit('chat:open', { all: true }, (res) => {
    if (my !== asked || !res) return;
    if (res.epoch !== epoch) {
      // (another server than last time - it has been restarted: what we had is gone there too)
      logs.all = [];
      logs.room = [];
      epoch = res.epoch;
    }
    me = res.me;
    max = res.max || 140;
    global = res.global !== false;
    merge('all', res.all || []);
    logs.room = [];
    merge('room', res.room || []);
    setTab(tab);
  });
}
function merge(to, list) {
  const have = new Set(logs[to].map((m) => m.id));
  for (const m of list) if (!have.has(m.id)) logs[to].push(m);
  logs[to].sort((a, b) => a.id - b.id);
  if (logs[to].length > 80) logs[to].splice(0, logs[to].length - 80);
}

function hear(m) {
  if (!m || (m.to !== 'all' && m.to !== 'room')) return;
  if (m.to === 'room' && !room) return;
  if (logs[m.to].some((x) => x.id === m.id)) return;
  merge(m.to, [m]);
  if (!m.sys && muted.has(m.from)) return;
  const showing = open && tab === m.to;
  if (showing) {
    const near = ui.list.scrollHeight - ui.list.scrollTop - ui.list.clientHeight < 80;
    const list = logs[tab].filter((x) => x.sys || !muted.has(x.from));
    if (ui.list.querySelector('.chat-empty')) ui.list.textContent = '';
    ui.list.append(item(m, list[list.length - 2]));
    while (ui.list.childElementCount > 80) ui.list.firstElementChild.remove();
    if (near || m.from === me) ui.list.scrollTop = ui.list.scrollHeight;
  } else if (!m.sys) {
    pop(m); // (your own too: you see it land, like everyone else)
    if (m.from === me) return;
    unread[m.to]++;
    if (m.to === 'room') opts.sfx?.play('tick', 0.6);
    badges();
  }
}

function say() {
  const text = ui.input.value.replace(/\s+/g, ' ').trim();
  if (!text || ui.send.disabled) return;
  const name = opts.name?.() || '';
  if (!name) {
    // (a name first: then back here, with what was typed still in the box)
    chat.close();
    return opts.askName?.(() => chat.toggle(true));
  }
  if (!socket?.connected) return setNote('Not connected. Try again in a moment.');
  ui.send.disabled = true;
  const to = tab;
  const look = opts.look?.();
  socket.timeout(6000).emit('chat:say', { to, text, name, look: look ? [look.style, look.colour] : undefined }, (err, res) => {
    ui.send.disabled = false;
    if (err || !res) return setNote('That did not get through. Try again.');
    if (res.ok) {
      ui.input.value = '';
      setNote('');
      if (opts.inGame?.()) return chat.close(true); // (said: back to the match)
    } else if (res.error) setNote(res.error);
    ui.input.focus();
  });
}

export const chat = {
  init(o) {
    opts = o || {};
    socket = o.socket;
    build();
    socket.on('chat', hear);
    socket.on('connect', ask); // (again after every reconnection: the server may have forgotten us - or everything)
    setTab(tab);
  },
  get isOpen() {
    return open;
  },
  // we came into a room, or left one; or there is to be no chat for now (no name yet)
  sync(now) {
    const was = { visible, room };
    visible = !now.hidden;
    room = now.room || '';
    if (!ui) return;
    if (room !== was.room) {
      logs.room = [];
      unread.room = 0;
      tab = room ? 'room' : 'all';
    }
    if (!visible) {
      this.close(true);
      ui.tabBtn.hidden = true;
      ui.feed.textContent = '';
      return;
    }
    ui.tabBtn.hidden = open;
    if (!was.visible || room !== was.room || !me) ask();
    setTab(tab);
  },
  toggle(on = !open) {
    if (!ui || !visible) return;
    if (!on) return this.close();
    open = true;
    ui.box.hidden = false;
    ui.tabBtn.hidden = true;
    ui.tabBtn.setAttribute('aria-expanded', 'true');
    ui.feed.textContent = ''; // (it is all in the scroll now)
    setTab(tab);
    opts.onOpen?.();
    land();
  },
  // open on one leaf ('friends', say)
  show(to) {
    if (!ui || !visible) return;
    tab = to;
    if (open) setTab(tab);
    else this.toggle(true);
  },
  // the friends changed (or the account did): paint them, and what is waiting
  people() {
    if (!ui) return;
    if (tab === 'friends' || !friendsOn()) setTab(tab);
    badges();
  },
  invited(v) {
    opts.sfx?.play('join', 0.7);
    if (!(open && tab === 'friends')) popInvite(v);
    badges();
  },
  isMuted: (from) => muted.has(from),
  mute(from, on = true) {
    if (!from) return;
    if (on) muted.add(from);
    else muted.delete(from);
    saveMuted();
    paint();
  },
  close(quiet = false) {
    if (!ui || !open) return;
    const had = ui.box.contains(document.activeElement);
    open = false;
    ui.box.hidden = true;
    ui.tabBtn.hidden = !visible;
    ui.tabBtn.setAttribute('aria-expanded', 'false');
    watchPeople();
    if (had) document.activeElement.blur();
    if (had && !quiet && visible && !opts.inGame?.()) ui.tabBtn.focus();
    opts.onOpen?.();
  },
};
