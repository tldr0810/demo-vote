import { describe, expect, it } from 'vitest'
import type { TallyRow } from '../app/api'
import { joinNames, leaders, rankTally } from '../app/ranking'

/** Rows in the order getTally returns them: count desc, then slot asc. */
function tally(...rows: [name: string, votes: number][]): TallyRow[] {
  return rows.map(([name, votes], index) => ({
    demoId: `dmo_${index}`,
    slot: index + 1,
    name,
    team: '',
    votes,
  }))
}

describe('rankTally', () => {
  it('numbers a clear result one, two, three', () => {
    const ranked = rankTally(tally(['A', 9], ['B', 5], ['C', 2]))
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3])
    expect(ranked.map((row) => row.leading)).toEqual([true, false, false])
  })

  it('gives tied demos the same rank', () => {
    // The whole reason this module exists. Both are first; the array order
    // between them is slot number, which is not a result.
    const ranked = rankTally(tally(['A', 12], ['B', 12], ['C', 4]))
    expect(ranked.map((row) => row.rank)).toEqual([1, 1, 3])
    expect(ranked.map((row) => row.leading)).toEqual([true, true, false])
  })

  it('skips the ranks a tie consumed', () => {
    const ranked = rankTally(tally(['A', 9], ['B', 4], ['C', 4], ['D', 1]))
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 2, 4])
  })

  it('leads nobody when nobody voted', () => {
    // Zero votes each is not a five-way tie for first, and highlighting every
    // bar on a projector would read as five winners.
    const ranked = rankTally(tally(['A', 0], ['B', 0]))
    expect(ranked.map((row) => row.rank)).toEqual([1, 1])
    expect(ranked.map((row) => row.leading)).toEqual([false, false])
  })

  it('handles an empty tally', () => {
    expect(rankTally([])).toEqual([])
  })

  it('carries every original field through', () => {
    const [row] = rankTally(tally(['A', 3]))
    expect(row).toMatchObject({ demoId: 'dmo_0', slot: 1, name: 'A', team: '', votes: 3 })
  })
})

describe('leaders', () => {
  it('returns the single winner', () => {
    expect(leaders(tally(['A', 9], ['B', 5])).map((row) => row.name)).toEqual(['A'])
  })

  it('returns every demo on the top count', () => {
    expect(leaders(tally(['A', 7], ['B', 7], ['C', 7], ['D', 1])).map((row) => row.name)).toEqual([
      'A',
      'B',
      'C',
    ])
  })

  it('returns nobody when no votes were cast', () => {
    expect(leaders(tally(['A', 0], ['B', 0]))).toEqual([])
    expect(leaders([])).toEqual([])
  })
})

describe('joinNames', () => {
  it('reads as a sentence at every length', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C')
  })
})
