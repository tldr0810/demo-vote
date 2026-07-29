// Ranking is its own module because two screens have to agree about it. The
// projector announces a winner in 4rem type and every phone in the room renders
// the same standings a moment later; if those two disagree about who came first,
// the room finds out immediately.

import type { TallyRow } from './api'

export type RankedRow = TallyRow & {
  /** Competition rank: equal counts share a rank, and the next rank skips. */
  rank: number
  /** True for every row sharing the top count, provided that count is not zero. */
  leading: boolean
}

/**
 * Numbers the tally, letting equal counts share a place.
 *
 * The server sorts by count desc then slot asc, which is a total order and so
 * always names somebody first. That is right for laying rows out and wrong for
 * labelling them: with two demos on twelve votes each, position in the array is
 * decided by slot number, and rendering it as 01 and 02 tells a room that the
 * demo with the lower slot number won. It did not. It tied.
 */
export function rankTally(tally: TallyRow[]): RankedRow[] {
  const topVotes = tally[0]?.votes ?? 0

  let rank = 0
  let previousVotes: number | null = null

  return tally.map((row, index) => {
    // Only advance the rank when the count actually changes, so a tie shares a
    // number and the place after a two-way tie for first is third.
    if (previousVotes === null || row.votes !== previousVotes) {
      rank = index + 1
      previousVotes = row.votes
    }
    return { ...row, rank, leading: row.votes === topVotes && row.votes > 0 }
  })
}

/** Every demo sharing the top count. Empty when nobody voted. */
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
