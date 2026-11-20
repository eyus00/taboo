// A player's record: what they have done in the game, as one plain object - and the only
// code that counts into it. Shared, because it is counted in two places: in the browser,
// for someone playing without an account (public/js/profile.js keeps it in the browser's
// storage), and on the server, for someone with one (accounts.js keeps it in the database).
// Both must count a round exactly alike, so both call countRound below.
//
// Nothing here touches storage, the network or the page.

export const VERSION = 1;
const MODES = ['potato', 'time', 'team', 'ko']; // Hot Potato, Least Time, Team Bomb, Knockout (a tournament's rounds)
const RECENT = 12;
const MAX = 1e9;

export const blank = () => ({
  app: 'onigokko',
  kind: 'profile',
  v: VERSION,
  id: `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
  name: '',
  look: { style: 'ink', colour: 0 }, // how you show yourself outside a match: a character of one of the art styles, in one of its ten colours
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
  team: { flags: 0, plus: 0, minus: 0, blown: 0 }, // flags taken, points made and lost, bombs that went off in hand
  cups: { ko: { played: 0, won: 0 }, team: { played: 0, won: 0 } },
  styles: {}, // rounds played in each art style
  stages: {}, // and on each stage
  recent: [], // the last few rounds, oldest first: { at, mode, r: 'W' | 'L' | 'D' }
});

export const int = (v, max = MAX) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);
export const idish = (k) => typeof k === 'string' && /^[a-z0-9_-]{1,24}$/.test(k);

// Whatever comes in - from storage, from a file - goes through here: only what a profile
// has is kept, every number is made a sane whole number, every key a short plain one.
export function tidy(raw) {
  const p = blank();
  if (!raw || typeof raw !== 'object') return p;
  if (typeof raw.id === 'string' && /^p_[a-z0-9]{6,40}$/.test(raw.id)) p.id = raw.id;
  if (typeof raw.name === 'string') p.name = raw.name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);
  if (idish(raw.look?.style)) p.look.style = raw.look.style;
  p.look.colour = int(raw.look?.colour, 9);
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

// One round that has just ended, counted into `p`. `res` is the 'end' message of the round,
// ctx = { slot (who this is about), theme, arena, duration (s) }. Returns whether it counted:
// only whole rounds played to the buzzer do (not one that ended because everyone else left),
// and only for someone who played in it.
export function countRound(p, res, { slot, theme = '', arena = '', duration = 0 } = {}, now = Date.now()) {
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
  }
  if (idish(theme)) p.styles[theme] = (p.styles[theme] || 0) + 1;
  if (idish(arena)) p.stages[arena] = (p.stages[arena] || 0) + 1;
  p.recent.push({ at: now, mode, r });
  if (p.recent.length > RECENT) p.recent.splice(0, p.recent.length - RECENT);
  p.updated = now;
  return true;
}

// One tournament that has just ended; kind: 'ko' | 'team'.
export function countCup(p, kind, won) {
  if (kind !== 'ko' && kind !== 'team') return false;
  p.cups[kind].played++;
  if (won) p.cups[kind].won++;
  return true;
}

// A record as a file (to keep a copy, or to carry it to another device), and back.
export function toFile(p, name = '') {
  const out = { ...p, name: String(name).slice(0, 12), exported: new Date().toISOString() };
  const safe = (out.name || 'player').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
  return { filename: `onigokko-${safe}.json`, text: `${JSON.stringify(out, null, 2)}\n` };
}
export function fromText(text) {
  let raw;
  try {
    raw = JSON.parse(String(text).slice(0, 200000));
  } catch {
    return { ok: false, error: 'That file is not a profile: it could not be read.' };
  }
  if (!raw || raw.app !== 'onigokko' || raw.kind !== 'profile') return { ok: false, error: 'That file is not an Onigokko profile.' };
  if (!(raw.v >= 1 && raw.v <= VERSION)) return { ok: false, error: 'That profile was saved by a newer version of the game.' };
  return { ok: true, data: tidy(raw) };
}
