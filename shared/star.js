// The star of a round: the one player whose round it was. The server works it out once
// (the result names them: `star`), from the very rows everybody is shown - so every
// screen stars the same player, and nobody can talk their own browser into it.
//
//   worth(row, team)   what one player's round was worth
//       a team game: the points they earned their side, less the points their bombs cost
//       it, and three for every bomb passed on and every flag taken
//       everyone for themselves: two for every tag made, less a point for every second as the oni
//   roundStar(rows, { team, win, loser }) -> a slot, or -1 when nobody stands out (see best)
//       team: from the side that won the round (a drawn round: from everyone)
//       everyone for themselves: from whoever was not the oni at the buzzer

export function worth(r, team) {
  if (!r) return 0;
  if (team) return (r.plus || 0) - (r.minus || 0) + 3 * (r.tags || 0) + 3 * (r.caps || 0);
  return 2 * (r.tags || 0) - (r.ms || 0) / 1000;
}

// the best of `pool` ([{ slot, w, ms, tags }]): the most worth; level on that, whoever was the
// oni (or held a bomb) for less; level on that too, whoever made more tags. Still level: nobody -
// two players with nothing to tell them apart have not stood out.
export function best(pool) {
  const key = (x) => [-(x.w || 0), x.ms || 0, -(x.tags || 0)];
  const cmp = (a, b) => {
    const [ka, kb] = [key(a), key(b)];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return 0;
  };
  const ranked = pool.slice().sort((a, b) => cmp(a, b) || a.slot - b.slot);
  if (!ranked.length) return -1;
  if (ranked.length > 1 && cmp(ranked[0], ranked[1]) === 0) return -1;
  return ranked[0].slot;
}

export function roundStar(rows, { team = false, win = -1, loser = -1 } = {}) {
  const pool = (rows || []).filter((r) => (team ? win < 0 || r.team === win : r.slot !== loser));
  return best(pool.map((r) => ({ slot: r.slot, w: worth(r, team), ms: r.ms || 0, tags: r.tags || 0 })));
}
