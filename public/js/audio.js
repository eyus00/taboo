// Tiny synth for sound effects - no audio files. Each art style gets its own
// waveform and pitch so the same events sound different in every world.

const VOICES = {
  neon: { wave: 'sawtooth', pitch: 1, noise: 0.5 },
  nightmare: { wave: 'sine', pitch: 0.55, noise: 1 },
  sketch: { wave: 'triangle', pitch: 1.15, noise: 0.35 },
  arcade: { wave: 'square', pitch: 1, noise: 0.4 },
  ink: { wave: 'sine', pitch: 1.4, noise: 0.25 },
  space: { wave: 'sine', pitch: 0.85, noise: 0.3 },
  alien: { wave: 'triangle', pitch: 0.7, noise: 0.45 },
};

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('tag.muted') === '1';
    } catch {}
    this.voice = VOICES.ink;
    // Browsers only allow sound after the first click / key press.
    const unlock = () => {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          this.ctx = new AC();
          this.out = this.ctx.createGain();
          this.out.gain.value = 0.5;
          this.out.connect(this.ctx.destination);
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  setTheme(id) {
    this.voice = VOICES[id] || VOICES.ink;
  }

  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('tag.muted', this.muted ? '1' : '0');
    } catch {}
    return this.muted;
  }

  // One oscillator note with a pitch slide and a fast decay.
  tone(f0, f1, dur, vol = 0.2, wave = this.voice.wave, delay = 0) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = wave;
    o.frequency.setValueAtTime(f0 * this.voice.pitch, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * this.voice.pitch), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol = 0.2, freq = 1200) {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol * this.voice.noise;
    src.connect(f).connect(g).connect(this.out);
    src.start(t);
  }

  play(name, vol = 1) {
    switch (name) {
      case 'jump':
        this.tone(300, 640, 0.13, 0.13 * vol);
        break;
      case 'airjump':
        this.tone(520, 980, 0.11, 0.11 * vol);
        break;
      case 'land':
        this.noise(0.07, 0.22 * vol, 500);
        break;
      case 'bounce':
        this.tone(180, 760, 0.22, 0.2 * vol, 'sine');
        this.tone(360, 1300, 0.18, 0.08 * vol, 'triangle', 0.02);
        break;
      case 'portal':
        this.tone(900, 220, 0.2, 0.12 * vol, 'sine');
        this.tone(240, 1100, 0.22, 0.1 * vol, 'sine', 0.08);
        break;
      case 'pick':
        [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.12, 0.14 * vol, 'triangle', i * 0.05));
        break;
      case 'block':
        this.noise(0.12, 0.4, 5000);
        this.tone(1400, 700, 0.25, 0.16, 'triangle');
        break;
      case 'freeze':
        [1800, 1500, 2100].forEach((f, i) => this.tone(f, f * 0.8, 0.16, 0.08 * vol, 'sine', i * 0.04));
        break;
      case 'tag':
        this.noise(0.18, 0.5, 2400);
        this.tone(900, 140, 0.28, 0.25);
        this.tone(1350, 210, 0.22, 0.12, 'square', 0.03);
        break;
      case 'tagged': // it's you now
        this.noise(0.25, 0.6, 1800);
        this.tone(520, 70, 0.45, 0.3);
        break;
      case 'fall':
        this.tone(500, 60, 0.4, 0.14 * vol);
        break;
      case 'respawn':
        this.tone(200, 800, 0.18, 0.1 * vol);
        break;
      case 'count':
        this.tone(440, 440, 0.12, 0.2);
        break;
      case 'go':
        this.tone(880, 880, 0.35, 0.22);
        this.tone(1320, 1320, 0.35, 0.1, undefined, 0.02);
        break;
      case 'tick':
        this.tone(1100, 1100, 0.05, 0.1, 'square');
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.22, 0.2, undefined, i * 0.11));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) => this.tone(f, f * 0.97, 0.26, 0.18, undefined, i * 0.15));
        break;
      case 'click':
        this.tone(660, 880, 0.06, 0.1);
        break;
      case 'join':
        this.tone(440, 660, 0.1, 0.12);
        this.tone(660, 990, 0.12, 0.1, undefined, 0.08);
        break;
    }
  }
}
