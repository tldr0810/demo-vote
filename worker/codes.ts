// Voting codes are printed on paper and handed out at check-in, then typed in
// by hand on a phone. Every decision here is about surviving that round trip.

// I, L, O, U, 0 and 1 are omitted. I/1/L and O/0 are the pairs people misread
// on a printed slip, and U/V is the pair they mishear when a code is read
// aloud. Excluding all of them means a misread character is an *invalid*
// character rather than a silently different valid code.
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_LENGTH = 8

// 30^8 ≈ 6.6e11. Paired with the per-IP rate limit in wrangler.toml, online
// guessing is hopeless rather than merely impractical.
const ALPHABET_SIZE = CODE_ALPHABET.length

// 256 is not a multiple of 30, so `byte % 30` would make the first 16 symbols
// slightly likelier than the rest. Reject the tail instead of accepting bias.
const REJECTION_CEILING = Math.floor(256 / ALPHABET_SIZE) * ALPHABET_SIZE

export function generateCode(): string {
  let out = ''
  const buffer = new Uint8Array(CODE_LENGTH * 2)
  while (out.length < CODE_LENGTH) {
    crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (byte >= REJECTION_CEILING) continue
      out += CODE_ALPHABET[byte % ALPHABET_SIZE]
      if (out.length === CODE_LENGTH) break
    }
  }
  return out
}

/** Generates `count` distinct codes. */
export function generateCodeBatch(count: number): string[] {
  const seen = new Set<string>()
  // A collision at this alphabet size is vanishingly unlikely, but a batch with
  // a duplicate would hand two people the same ballot, so dedupe rather than
  // assume.
  while (seen.size < count) seen.add(generateCode())
  return [...seen]
}

/**
 * Prepares user input for lookup: strips the spaces and dashes people add when
 * copying from paper, and uppercases. Does not attempt to "correct" characters
 * outside the alphabet — since none of them can appear in a real code, guessing
 * what the person meant would risk redeeming somebody else's code.
 */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}

export function isValidCodeFormat(candidate: string): boolean {
  if (candidate.length !== CODE_LENGTH) return false
  for (const char of candidate) {
    if (!CODE_ALPHABET.includes(char)) return false
  }
  return true
}

/** Renders a batch as CSV for printing onto slips. */
export function codesToCsv(rows: { code: string; batch: string }[]): string {
  const body = rows.map((row) => `${row.code},${row.batch}`).join('\n')
  return `code,batch\n${body}\n`
}
