import { describe, expect, it } from 'vitest'
import { CODE_PARAM, codeFromSearch, personalVoteUrl } from '../app/voteUrl'

/**
 * The QR round trip.
 *
 * One side of this is printed onto paper weeks before an event and the other
 * runs on a stranger's phone during it. Nothing in between can be corrected once
 * the slips are cut, so the two halves are tested against each other rather than
 * against a hard-coded string either could drift from.
 */
describe('personal vote URLs', () => {
  it('round-trips a code through the URL it is printed into', () => {
    const url = personalVoteUrl('https://vote.example.com', 'evt_abc123', 'K7M29XYZ')
    expect(url).toBe(`https://vote.example.com/v/evt_abc123?${CODE_PARAM}=K7M29XYZ`)
    expect(codeFromSearch(new URL(url).search)).toBe('K7M29XYZ')
  })

  it('keeps the event in the path, so the code and the event cannot disagree', () => {
    // A code belongs to exactly one event and the server refuses it anywhere
    // else. Putting the event in the path means a scanned slip asks about the
    // event it was printed for, rather than whichever one happens to be current.
    const url = new URL(personalVoteUrl('https://vote.example.com', 'evt_abc123', 'K7M29XYZ'))
    expect(url.pathname).toBe('/v/evt_abc123')
  })

  it('normalises a scanned code the same way typed input is', () => {
    // A scanner that inserts a space, or a URL that came back lowercased from
    // some link handler in between, must not become an invalid code.
    expect(codeFromSearch('?c=k7m29xyz')).toBe('K7M29XYZ')
    expect(codeFromSearch('?c=K7M2%209XYZ')).toBe('K7M29XYZ')
    expect(codeFromSearch('?c=K7M2-9XYZ')).toBe('K7M29XYZ')
  })

  it('reads nothing out of a URL that carries no code', () => {
    expect(codeFromSearch('')).toBeNull()
    expect(codeFromSearch('?other=1')).toBeNull()
    // An empty parameter is a scanner that dropped the value, not a code.
    expect(codeFromSearch('?c=')).toBeNull()
  })
})
