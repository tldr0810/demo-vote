// Colour contrast gate for the design tokens.
//
//   node scripts/check-contrast.mjs        # part of `npm run check`
//   node scripts/check-contrast.mjs -v     # print every pair, passing or not
//
// This is a script rather than a vitest case because the test suite runs inside
// workerd, which has no filesystem, and `?raw` on a stylesheet resolves to an
// empty string under the Cloudflare vite plugin. Reading app.css itself is the
// point: a list of hexes maintained alongside the stylesheet would drift from it
// silently, and the drift would first be visible on a projector in front of a
// room.
//
// Both floors come from WCAG 2.1: 4.5:1 for text below the large-text threshold
// (1.4.3) and 3:1 for a graphic that carries information (1.4.11). Everything
// text-shaped in this app is small: 13px hints, a 14px rank column, 11px pills.

import { readFile } from 'node:fs/promises'

const CSS_PATH = new URL('../app/styles/app.css', import.meta.url)
const LIGHT_MARKER = '@media (prefers-color-scheme: light)'
const verbose = process.argv.includes('-v')

/** https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function readTokens(source) {
  const found = {}
  for (const [, name, value] of source.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found[name] = value.toLowerCase()
  }
  return found
}

const css = await readFile(CSS_PATH, 'utf8')
const split = css.indexOf(LIGHT_MARKER)
if (split === -1) {
  console.error(`FAIL could not find the light theme block (${LIGHT_MARKER}) in app.css`)
  process.exit(1)
}

// Light overrides only some tokens, so it inherits whatever it does not restate,
// exactly as the cascade would resolve it.
const dark = readTokens(css.slice(0, split))
const light = { ...dark, ...readTokens(css.slice(split)) }

let failures = 0
let theme = ''

function check(label, ratio, floor) {
  const passed = ratio >= floor
  if (!passed) failures += 1
  if (!passed || verbose) {
    console.log(
      `${passed ? 'ok  ' : 'FAIL'} ${theme}: ${label} — ${ratio.toFixed(2)}:1 (needs ${floor})`,
    )
  }
}

for (const [name, t] of [
  ['dark', dark],
  ['light', light],
]) {
  theme = name

  // Guards the parser, not the palette: a regex that quietly matched nothing
  // would make every assertion below pass against undefined.
  for (const token of [
    '--bg',
    '--surface',
    '--surface-raised',
    '--line',
    '--line-strong',
    '--text',
    '--text-muted',
    '--text-faint',
    '--accent',
    '--accent-ink',
    '--accent-dim',
    '--warn',
    '--danger',
    '--danger-ink',
    '--info',
  ]) {
    if (!t[token]) {
      console.error(`FAIL ${name}: ${token} was not found in app.css`)
      failures += 1
    }
  }
  if (failures > 0) break

  // The tally bars. A fill indistinguishable from its own track is not a
  // quieter bar, it is a missing one.
  check('ordinary bar vs its track', contrast(t['--accent-dim'], t['--line']), 3)
  check('leading bar vs its track', contrast(t['--accent'], t['--line']), 3)

  // Deliberately 1.5 and not 3. On the light side every colour clearing 3:1
  // against the track is darker than the track, so demanding 3:1 here as well
  // would drive the winner's bar to near-black and rank it visually below the
  // demos it beat. Leading is carried by position, by weight on the rank and by
  // colour together; this only asks that the two bars are not the same bar.
  check('leading bar vs an ordinary bar', contrast(t['--accent'], t['--accent-dim']), 1.5)

  // A raised surface has to be a different surface. This is the check that was
  // missing: --surface-raised was #ffffff in the light theme, the same value as
  // --surface, so scoring a demo changed the card's fill by nothing at all.
  // Deliberately a low floor — this is a tonal step between two backgrounds, not
  // a figure/ground pair, and asking for 3:1 here would make a scored card look
  // like a different component rather than the same one filled in.
  check('raised surface differs from the surface under it', contrast(t['--surface-raised'], t['--surface']), 1.03)

  // Small text, on the page and on both surfaces, since all three occur.
  for (const surface of ['--bg', '--surface', '--surface-raised']) {
    check(`faint text on ${surface}`, contrast(t['--text-faint'], t[surface]), 4.5)
    check(`accent text on ${surface}`, contrast(t['--accent'], t[surface]), 4.5)
    check(`countdown warn on ${surface}`, contrast(t['--warn'], t[surface]), 4.5)
    check(`countdown urgent on ${surface}`, contrast(t['--danger'], t[surface]), 4.5)
    // The revealed pill. 11px uppercase, so it is held to the small-text floor
    // like every other pill in the set.
    check(`revealed pill on ${surface}`, contrast(t['--info'], t[surface]), 4.5)
  }

  // The closed pill is the one that is filled rather than outlined, so its label
  // is read against --line-strong and not against the surface behind it.
  check('closed pill label', contrast(t['--text'], t['--line-strong']), 4.5)

  // Two greys with different names have to be two greys, or the app has one
  // grey wearing two token names and no tonal ladder at all.
  check(
    'muted text is clearer than faint text',
    contrast(t['--text-muted'], t['--bg']) / contrast(t['--text-faint'], t['--bg']),
    1.05,
  )

  check('primary button label', contrast(t['--accent-ink'], t['--accent']), 4.5)
  // --danger-ink exists so this can pass without repainting --danger, which is
  // also the urgent countdown and is tuned to be seen rather than written on.
  check('destructive button label', contrast(t['--danger-ink'], t['--danger']), 4.5)
}

if (failures > 0) {
  console.error(`\n${failures} contrast check${failures === 1 ? '' : 's'} failed`)
  process.exit(1)
}
console.log('contrast: all pairs pass in both themes')
