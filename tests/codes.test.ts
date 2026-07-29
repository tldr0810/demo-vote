import { describe, expect, it } from 'vitest'
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  codesToCsv,
  generateCode,
  generateCodeBatch,
  isValidCodeFormat,
  normalizeCode,
} from '../worker/codes'

describe('code alphabet', () => {
  it('excludes every character pair that is misread on a printed slip', () => {
    for (const excluded of ['I', 'L', 'O', 'U', '0', '1']) {
      expect(CODE_ALPHABET).not.toContain(excluded)
    }
  })

  it('has no duplicate symbols', () => {
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length)
  })
})

describe('generateCode', () => {
  it('produces codes of the declared length using only alphabet characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode()
      expect(code).toHaveLength(CODE_LENGTH)
      expect(isValidCodeFormat(code)).toBe(true)
    }
  })

  it('distributes symbols without obvious modulo bias', () => {
    // Rejection sampling should keep every symbol within a wide band of the
    // expected count. A naive `byte % 30` makes the first 16 symbols roughly
    // 1.5x likelier, which this bound would catch.
    const counts = new Map<string, number>()
    const samples = 3000
    for (let i = 0; i < samples; i += 1) {
      for (const char of generateCode()) {
        counts.set(char, (counts.get(char) ?? 0) + 1)
      }
    }
    const expected = (samples * CODE_LENGTH) / CODE_ALPHABET.length
    for (const symbol of CODE_ALPHABET) {
      const seen = counts.get(symbol) ?? 0
      expect(seen).toBeGreaterThan(expected * 0.75)
      expect(seen).toBeLessThan(expected * 1.25)
    }
  })
})

describe('generateCodeBatch', () => {
  it('returns the requested number of distinct codes', () => {
    const batch = generateCodeBatch(500)
    expect(batch).toHaveLength(500)
    expect(new Set(batch).size).toBe(500)
  })
})

describe('normalizeCode', () => {
  it('accepts the ways people retype a code from paper', () => {
    expect(normalizeCode(' k7m2-9xyz ')).toBe('K7M29XYZ')
    expect(normalizeCode('K7M2 9XYZ')).toBe('K7M29XYZ')
  })

  it('does not invent substitutions for characters outside the alphabet', () => {
    // 'O' can never appear in a real code. Silently rewriting it to something
    // valid could redeem a different attendee's code.
    expect(isValidCodeFormat(normalizeCode('OOOOOOOO'))).toBe(false)
    expect(isValidCodeFormat(normalizeCode('11111111'))).toBe(false)
  })
})

describe('isValidCodeFormat', () => {
  it('rejects wrong lengths', () => {
    expect(isValidCodeFormat('K7M29XY')).toBe(false)
    expect(isValidCodeFormat('K7M29XYZQ')).toBe(false)
  })
})

describe('codesToCsv', () => {
  it('emits a header and one row per code', () => {
    const csv = codesToCsv([
      { code: 'K7M29XYZ', batch: 'b1' },
      { code: 'P4RT6WQN', batch: 'b1' },
    ])
    expect(csv).toBe('code,batch\nK7M29XYZ,b1\nP4RT6WQN,b1\n')
  })
})
