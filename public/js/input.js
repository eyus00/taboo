// Keyboard + on-screen touch controls -> one small bitmask per tick.
// Five actions: left, right, jump (again in the air: double jump), down (drop
// through thin ledges and slopes, fall faster) and use (the item in your hands).

import { IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, IN_USE } from '/shared/config.js';

const KEYS = {
  ArrowLeft: IN_LEFT,
  KeyA: IN_LEFT,
  ArrowRight: IN_RIGHT,
  KeyD: IN_RIGHT,
  ArrowUp: IN_JUMP,
  KeyW: IN_JUMP,
  Space: IN_JUMP,
  ArrowDown: IN_DOWN,
  KeyS: IN_DOWN,
  KeyE: IN_USE, // set off the item you are holding
  KeyX: IN_USE,
  ShiftLeft: IN_USE,
  ShiftRight: IN_USE,
};

// Jump and use happen when the button goes DOWN, and the game looks at the
// buttons once a tick. So that no press is ever lost between two looks:
//  * a tap shorter than a tick still counts (it is held until the next look);
//  * a button let go and pressed again between two looks - or pressed on a second
//    key while the first is still down - is shown to the game as up for one tick
//    and then down, so it reads as the new press it is.
// Presses the game never looked at (typed during the countdown, say) go stale.
const EDGE = [IN_JUMP, IN_USE];
const STALE_MS = 220;

export class Input {
  constructor() {
    this.held = new Set();
    this.touch = 0; // bits held by on-screen buttons
    this.pad = 0; // bits held by the left/right thumb pad
    this.active = false; // only swallow keys while a match is being played
    this.tap = 0; // bits that went down since the game last looked
    this.tapAt = 0;
    this.fresh = { [IN_JUMP]: [], [IN_USE]: [] }; // when each press not yet shown to the game was made
    this.last = 0; // what the game was shown last time

    addEventListener('keydown', (e) => {
      const bit = KEYS[e.code];
      if (!bit || !this.active || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.repeat && !this.held.has(e.code)) this.press(bit);
      this.held.add(e.code);
      e.preventDefault(); // no page scrolling with arrows / space
    });
    addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    const clear = () => this.clear();
    addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
  }

  // a button went down just now
  press(bit) {
    this.tap |= bit;
    this.tapAt = performance.now();
    const q = this.fresh[bit];
    if (q && q.length < 3) q.push(performance.now());
  }

  clear() {
    this.held.clear();
    this.touch = 0;
    this.pad = 0;
    this.tap = 0;
    this.last = 0;
    for (const bit of EDGE) this.fresh[bit].length = 0;
    for (const el of document.querySelectorAll('.touch .down')) el.classList.remove('down');
  }

  // Phones and tablets.
  //   [data-pad]  one wide strip for the left thumb: left half = left, right
  //               half = right, and you can slide across without lifting.
  //   [data-bit]  a plain button (jump, down).
  bindTouch(root) {
    const stop = (e) => e.preventDefault();
    for (const pad of root.querySelectorAll('[data-pad]')) {
      const [l, r] = pad.querySelectorAll('[data-side]');
      const set = (e) => {
        const box = pad.getBoundingClientRect();
        this.pad = e.clientX < box.left + box.width / 2 ? IN_LEFT : IN_RIGHT;
        l.classList.toggle('down', this.pad === IN_LEFT);
        r.classList.toggle('down', this.pad === IN_RIGHT);
      };
      const end = (e) => {
        stop(e);
        this.pad = 0;
        l.classList.remove('down');
        r.classList.remove('down');
      };
      pad.addEventListener('pointerdown', (e) => {
        stop(e);
        pad.setPointerCapture?.(e.pointerId);
        set(e);
      });
      pad.addEventListener('pointermove', (e) => {
        if (this.pad) set(e);
      });
      pad.addEventListener('pointerup', end);
      pad.addEventListener('pointercancel', end);
      pad.addEventListener('contextmenu', stop);
    }
    for (const el of root.querySelectorAll('[data-bit]')) {
      const bit = Number(el.dataset.bit);
      const on = (e) => {
        stop(e);
        el.setPointerCapture?.(e.pointerId);
        if (!(this.touch & bit)) this.press(bit);
        this.touch |= bit;
        el.classList.add('down');
      };
      const off = (e) => {
        stop(e);
        this.touch &= ~bit;
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('contextmenu', stop);
    }
  }

  // What is held, for one tick of the game. Call it exactly once a tick: it
  // hands out the presses made since the last call (see EDGE above).
  bits() {
    const now = performance.now();
    let b = this.touch | this.pad | (now - this.tapAt > STALE_MS ? 0 : this.tap);
    this.tap = 0;
    for (const code of this.held) b |= KEYS[code];
    for (const bit of EDGE) {
      const q = this.fresh[bit];
      while (q.length && now - q[0] > STALE_MS) q.shift();
      if (!q.length) continue;
      if (this.last & bit) b &= ~bit; // it was down a tick ago: up for this one, so the next is a press
      else {
        b |= bit;
        q.shift();
      }
    }
    this.last = b;
    return b; // left + right together simply cancel out in the physics
  }
}
