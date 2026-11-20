// Chat, everywhere: a bookmark on the right edge of the screen (or "/") opens a small scroll
// with two channels - the room you are in, and everyone who is connected. It is there in the
// menus and in a match alike; and whatever is said shows up for a few seconds in the corner
// of the screen as it is said, so nobody has to keep the scroll open to follow.
//
// The server is the only memory (see /chat.js at the top of the project): this file keeps
// what it has been sent while the page is open, and asks again whenever it reconnects or
// changes rooms. Nothing is stored in the browser but the list of people you have muted,
// and that only for this visit (their ids change with every connection anyway).
//
// A message is plain text from end to end: it is only ever set as textContent.
//
//   chat.init({ socket, sfx, name(): string, askName(then), look(): { style, colour },
//               avatar(look, size): Promise<url>, onOpen(), inGame(): boolean })
//   chat.sync({ room, hidden })   room: the code of the room we are in, or ''; hidden: no chat here at all (no name yet)
//   chat.toggle(open?)  chat.close()  chat.isOpen
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
};
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
      ui.input.focus();
    });
    tabs.append(b);
    return b;
  };
  const chRoom = mk('room', 'Room');
  const chAll = mk('all', 'Everyone');
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
  box.append(head, list, note, form);
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
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      chat.close();
    }
  });
  for (const type of ['keyup', 'keypress']) input.addEventListener(type, (e) => e.stopPropagation());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    say();
  });
  ui = { tabBtn, box, list, note, form, input, send, chRoom, chAll, feed, badge: tabBtn.querySelector('.chat-badge') };
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
function item(m, prev) {
  if (m.sys) return el('li', 'chat-sys', m.text);
  const li = el('li', m.from === me ? 'chat-msg mine' : 'chat-msg');
  li.dataset.from = m.from;
  const joined = prev && !prev.sys && prev.from === m.from && prev.name === m.name && m.at - prev.at < GROUP_MS;
  if (!joined) {
    const head = el('div', 'chat-who');
    head.append(sealOf(m), el('b', '', m.name), el('time', '', clock(m.at)));
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

function paint() {
  if (!ui) return;
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

function setNote(text, action = '', run = null) {
  if (!ui) return;
  ui.note.textContent = text || NOTES[tab];
  ui.note.classList.toggle('warn', !!text && !action);
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
  // on the bookmark: how much is waiting in the room - or, failing that, a dot for the rest
  show(ui.badge, unread.room || unread.all, !unread.room);
}

function setTab(to) {
  if (to === 'room' && !room) to = 'all';
  if (to === 'all' && !global) to = room ? 'room' : 'all';
  tab = to;
  if (!ui) return;
  ui.chRoom.hidden = !room;
  ui.chAll.hidden = !global;
  for (const b of [ui.chRoom, ui.chAll]) b.setAttribute('aria-selected', String(b.dataset.to === tab));
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
    ui.input.focus();
  },
  close(quiet = false) {
    if (!ui || !open) return;
    const had = ui.box.contains(document.activeElement);
    open = false;
    ui.box.hidden = true;
    ui.tabBtn.hidden = !visible;
    ui.tabBtn.setAttribute('aria-expanded', 'false');
    if (had) document.activeElement.blur();
    if (had && !quiet && visible && !opts.inGame?.()) ui.tabBtn.focus();
    opts.onOpen?.();
  },
};
