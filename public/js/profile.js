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
//   profile.round(res, ctx)            count one round that has just ended; ctx = { slot, theme, arena, duration }
//   profile.setLook(style, colour)     the character you show yourself as (an art style's, in one of its colours)
//   profile.cup(kind, won)             count one tournament that has just ended; kind: 'ko' | 'team'
//   profile.toFile(name)               -> { filename, text }
//   profile.fromText(text)             -> { ok: true, data } | { ok: false, error }   (nothing is changed)
//   profile.replace(data)              take a profile read from a file
//   profile.reset()
//
// Only whole rounds played to the buzzer are counted (not one that ended because everyone
// else left), and only rounds you played in (not ones you watched).

import { blank, tidy, countRound, countCup, toFile, fromText, int, idish } from '/shared/record.js';

const KEY = 'tag.profile';

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

  // One round, as the server reported it: res is the 'end' message (see countRound in /shared/record.js).
  round(res, ctx) {
    const counted = countRound(load(), res, ctx);
    if (counted) save();
    return counted;
  },

  setLook(style, colour) {
    const p = load();
    if (idish(style)) p.look.style = style;
    p.look.colour = int(colour, 9);
    save();
    return { ...p.look };
  },

  cup(kind, won) {
    if (countCup(load(), kind, won)) save();
  },

  toFile(name = '') {
    return toFile(load(), name);
  },

  fromText,

  // take a whole record: one read from a file, or the one an account keeps on the server
  replace(next) {
    data = tidy(next);
    save();
  },

  reset() {
    const was = load();
    data = blank();
    data.id = was.id; // (the same profile, with nothing counted - and looking as it did)
    data.look = { ...was.look };
    save();
  },
};
