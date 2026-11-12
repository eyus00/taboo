// Keyboard + on-screen touch controls -> one small bitmask per tick.
// Four actions only: left, right, jump (again in the air: double jump) and
// down (drop through thin ledges and slopes, fall faster).

import { IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN } from '/shared/config.js';

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
};

export class Input {
  constructor() {
    this.held = new Set();
    this.touch = 0; // bits held by on-screen buttons
    this.pad = 0; // bits held by the left/right thumb pad
    this.active = false; // only swallow keys while a match is being played

    addEventListener('keydown', (e) => {
      const bit = KEYS[e.code];
      if (!bit || !this.active || e.ctrlKey || e.metaKey || e.altKey) return;
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

  clear() {
    this.held.clear();
    this.touch = 0;
    this.pad = 0;
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

  bits() {
    let b = this.touch | this.pad;
    for (const code of this.held) b |= KEYS[code];
    return b; // left + right together simply cancel out in the physics
  }
}
