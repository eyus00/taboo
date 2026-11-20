// Your profile: what you have done in the game, counted on this device.
//
// It lives in the browser's own storage and nowhere else - there are no accounts and the
// server never sees it. It can be saved to a file (to keep a copy, or to carry it to another
// device) and read back from one. A file is plain JSON: anyone can open and change it, so
// these numbers are a diary, not a ranking.
//
// The shape is versioned (`v`) and carries a random `id`, so that a later version can offer
// to keep a profile on a server under a code of its own without changing what is counted.
//
//   profile.get()                      -> the profile (a copy)
//   profile.round(res, ctx)            count one round that has just ended; ctx = { slot, theme, arena, duration, star }
//   profile.cup(kind, won)             count one tournament that has just ended; kind: 'ko' | 'team'
//   profile.toFile(name)               -> { filename, text }
//   profile.fromText(text)             -> { ok: true, data } | { ok: false, error }   (nothing is changed)
//   profile.replace(data)              take a profile read from a file
//   profile.reset()
//
// Only whole rounds played to the buzzer are counted (not one that ended because everyone
// else left), and only rounds you played in (not ones you watched).

const KEY = 'tag.profile';
const VERSION = 1;
const MODES = ['potato', 'time', 'team', 'ko']; // Hot Potato, Least Time, Team Bomb, Knockout (a tournament's rounds)
const RECENT = 12;
const MAX = 1e9;

const blank = () => ({
  app: 'onigokko',
  kind: 'profile',
  v: VERSION,
  id: `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
  name: '',
  since: Date.now(),
  updated: 0,
  rounds: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  streak: 0, // wins in a row, now
  best: 0, // and the most there have been
  playMs: 0, // time on the clock of the rounds played
  oniMs: 0, // of which as the oni (or holding a bomb)
  tags: 0, // tags made (bombs passed on, in a team game)
  by: Object.fromEntries(MODES.map((m) => [m, { rounds: 0, wins: 0 }])),
  team: { flags: 0, plus: 0, minus: 0, blown: 0, stars: 0 }, // flags taken, points made and lost, bombs that went off in hand, rounds as the winners' best
  cups: { ko: { played: 0, won: 0 }, team: { played: 0, won: 0 } },
  styles: {}, // rounds played in each art style
  stages: {}, // and on each stage
  recent: [], // the last few rounds, oldest first: { at, mode, r: 'W' | 'L' | 'D' }
});

const int = (v, max = MAX) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
const idish = (k) => typeof k === 'string' && /^[a-z0-9_-]{1,24}$/.test(k);

// Whatever comes in - from storage, from a file - goes through here: only what a profile
// has is kept, every number is made a sane whole number, every key a short plain one.
function tidy(raw) {
  const p = blank();
  if (!raw || typeof raw !== 'object') return p;
  if (typeof raw.id === 'string' && /^p_[a-z0-9]{6,40}$/.test(raw.id)) p.id = raw.id;
  if (typeof raw.name === 'string') p.name = raw.name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  p.since = int(raw.since, 4e12) || p.since;
  p.updated = int(raw.updated, 4e12);
  for (const k of ['rounds', 'wins', 'losses', 'draws', 'streak', 'best', 'playMs', 'oniMs', 'tags']) p[k] = int(raw[k], k.endsWith('Ms') ? 1e13 : MAX);
  for (const m of MODES) {
    p.by[m].rounds = int(raw.by?.[m]?.rounds);
    p.by[m].wins = Math.min(p.by[m].rounds, int(raw.by?.[m]?.wins));
  }
  for (const k of Object.keys(p.team)) p.team[k] = int(raw.team?.[k]);
  for (const c of ['ko', 'team']) {
    p.cups[c].played = int(raw.cups?.[c]?.played);
    p.cups[c].won = Math.min(p.cups[c].played, int(raw.cups?.[c]?.won));
  }
  for (const what of ['styles', 'stages']) {
    const src = raw[what] && typeof raw[what] === 'object' ? raw[what] : {};
    for (const k of Object.keys(src).slice(0, 40)) if (idish(k) && int(src[k]) > 0) p[what][k] = int(src[k]);
  }
  if (Array.isArray(raw.recent)) {
    p.recent = raw.recent
      .filter((x) => x && MODES.includes(x.mode) && ['W', 'L', 'D'].includes(x.r))
      .slice(-RECENT)
      .map((x) => ({ at: int(x.at, 4e12), mode: x.mode, r: x.r }));
  }
  // (what cannot be true is made true: no more wins than rounds, no streak longer than the wins)
  p.wins = Math.min(p.wins, p.rounds);
  p.losses = Math.min(p.losses, p.rounds - p.wins);
  p.draws = Math.min(p.draws, p.rounds - p.wins - p.losses);
  p.best = Math.min(Math.max(p.best, p.streak), p.wins);
  p.streak = Math.min(p.streak, p.best);
  return p;
}

let data = null;
function load() {
  if (data) return data;
  try {
    data = tidy(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    data = blank();
  }
  return data;
}
function save() {
  data.updated = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

export const profile = {
  get() {
    return structuredClone(load());
  },

  // One round, as the server (or the browser, in practice) reported it: res is the 'end' message.
  round(res, { slot, theme = '', arena = '', duration = 0, star = false } = {}) {
    const p = load();
    const mine = res?.rows?.find((x) => x.slot === slot);
    if (!mine || res.reason === 'forfeit') return false;
    const ko = !!res.cup?.ko;
    const mode = res.team ? 'team' : ko ? 'ko' : res.mode === 'time' ? 'time' : 'potato';
    let r;
    if (res.team) r = res.team.win < 0 ? 'D' : res.team.win === mine.team ? 'W' : 'L';
    else if (ko) r = res.cup.caught === slot ? 'L' : 'W';
    else if (mode === 'potato') r = res.loser === slot ? 'L' : 'W';
    else r = res.winners.includes(slot) ? 'W' : 'L';
    p.rounds++;
    p.by[mode].rounds++;
    if (r === 'W') {
      p.wins++;
      p.by[mode].wins++;
      p.streak++;
      p.best = Math.max(p.best, p.streak);
    } else {
      if (r === 'L') p.losses++;
      else p.draws++;
      p.streak = 0;
    }
    p.playMs += int(duration * 1000);
    p.oniMs += int(mine.ms);
    p.tags += int(mine.tags);
    if (res.team) {
      p.team.flags += int(mine.caps);
      p.team.plus += int(mine.plus);
      p.team.minus += int(mine.minus);
      if (mine.boom) p.team.blown++;
      if (star) p.team.stars++;
    }
    if (idish(theme)) p.styles[theme] = (p.styles[theme] || 0) + 1;
    if (idish(arena)) p.stages[arena] = (p.stages[arena] || 0) + 1;
    p.recent.push({ at: Date.now(), mode, r });
    if (p.recent.length > RECENT) p.recent.splice(0, p.recent.length - RECENT);
    save();
    return true;
  },

  cup(kind, won) {
    const p = load();
    if (kind !== 'ko' && kind !== 'team') return;
    p.cups[kind].played++;
    if (won) p.cups[kind].won++;
    save();
  },

  toFile(name = '') {
    const p = { ...load(), name: String(name).slice(0, 12), exported: new Date().toISOString() };
    const safe = (p.name || 'player').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
    return { filename: `onigokko-${safe}.json`, text: `${JSON.stringify(p, null, 2)}\n` };
  },

  fromText(text) {
    let raw;
    try {
      raw = JSON.parse(String(text).slice(0, 200000));
    } catch {
      return { ok: false, error: 'That file is not a profile: it could not be read.' };
    }
    if (!raw || raw.app !== 'onigokko' || raw.kind !== 'profile') return { ok: false, error: 'That file is not an Onigokko profile.' };
    if (!(raw.v >= 1 && raw.v <= VERSION)) return { ok: false, error: 'That profile was saved by a newer version of the game.' };
    return { ok: true, data: tidy(raw) };
  },

  replace(next) {
    data = tidy(next);
    save();
  },

  reset() {
    const keep = load().id;
    data = blank();
    data.id = keep;
    save();
  },
};
