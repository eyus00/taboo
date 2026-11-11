// Keyboard + on-screen touch buttons -> one small bitmask per tick.
//   move A/D or arrows, jump W/Up/Space (press again in the air to double jump),
//   down S/Down (drop through thin ledges, fall faster), dash Shift/E/X/K

import { IN_LEFT, IN_RIGHT, IN_JUMP, IN_DOWN, IN_DASH } from '/shared/config.js';

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
  ShiftLeft: IN_DASH,
  ShiftRight: IN_DASH,
  KeyE: IN_DASH,
  KeyX: IN_DASH,
  KeyK: IN_DASH,
};

export class Input {
  constructor() {
    this.held = new Set();
    this.touch = 0;
    this.active = false; // only swallow keys while a match is on screen

    addEventListener('keydown', (e) => {
      const bit = KEYS[e.code];
      if (!bit || !this.active || isTyping(e)) return;
      this.held.add(e.code);
      e.preventDefault(); // no page scrolling with arrows / space
    });
    addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    const clear = () => {
      this.held.clear();
      this.touch = 0;
    };
    addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
  }

  // Wire up <button data-bit="1|2|4|8|16"> elements for phones and tablets.
  bindTouch(root) {
    for (const el of root.querySelectorAll('[data-bit]')) {
      const bit = Number(el.dataset.bit);
      const on = (e) => {
        e.preventDefault();
        this.touch |= bit;
        el.classList.add('down');
      };
      const off = (e) => {
        e.preventDefault();
        this.touch &= ~bit;
        el.classList.remove('down');
      };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  bits() {
    let b = this.touch;
    for (const code of this.held) b |= KEYS[code];
    return b; // left + right together simply cancel out in the physics
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
