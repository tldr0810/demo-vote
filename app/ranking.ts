// Ranking is its own module because two screens have to agree about it. The
// projector announces a winner in 4rem type and every phone in the room renders
// the same standings a moment later; if those two disagree about who came first,
// the room finds out immediately.
//
// Rank is on the total score. Because only ballots that scored every demo are
// counted, every demo has the same number of raters, so ranking by total and
// ranking by average produce the same order — the total is simply the one that
// can be compared exactly.

import type { TallyRow } from './api'

export type RankedRow = TallyRow & {
  /** Competition rank: equal scores share a rank, and the next rank skips. */
  rank: number
  /** True for every row sharing the top score, provided that score is not zero. */
  leading: boolean
}

/**
 * Numbers the tally, letting equal scores share a place.
 *
 * The server sorts by score desc then slot asc, which is a total order and so
 * always names somebody first. That is right for laying rows out and wrong for
 * labelling them: with two demos on forty-eight points each, position in the
 * array is decided by slot number, and rendering it as 01 and 02 tells a room
 * that the demo with the lower slot number won. It did not. It tied.
 *
 * Ties are compared on the total, which is an integer sum of integer scores, so
 * this is exact. The average alongside it is a rounded float and two demos can
 * share one without being level; comparing on that would invent ties the room
 * would then see contradicted by the totals next to them.
 */
export function rankTally(tally: TallyRow[]): RankedRow[] {
  const topScore = tally[0]?.score ?? 0

  let rank = 0
  let previousScore: number | null = null

  return tally.map((row, index) => {
    // Only advance the rank when the score actually changes, so a tie shares a
    // number and the place after a two-way tie for first is third.
    if (previousScore === null || row.score !== previousScore) {
      rank = index + 1
      previousScore = row.score
    }
    return { ...row, rank, leading: row.score === topScore && row.score > 0 }
  })
}

/** Every demo sharing the top score. Empty when nobody scored. */
export function leaders(tally: TallyRow[]): TallyRow[] {
  return rankTally(tally).filter((row) => row.leading)
}

/**
 * The names of joint winners, as a sentence.
 *
 * Written out in full rather than truncated to "and 3 others": this is the one
 * line the whole room reads, and a demo that tied for first and did not get its
 * name on the screen has been told it lost.
 */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
