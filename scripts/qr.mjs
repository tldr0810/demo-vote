// Builds QR codes for an event, outside the browser.
//
//   npm run qr                          # local dev, LAN address, for testing
//   npm run qr https://vote.example.com/v/evt_abc123   # the shared one, for the wall
//   npm run qr https://vote.example.com/v/evt_abc123 codes-evt_abc123.csv
//                                       # one slip per code, as a printable sheet
//
// The dashboard's own /admin/print/<eventId> page does the same job with a
// print dialogue attached, and is the path to reach for. This exists for the
// case that page cannot cover: a venue with no network, a laptop that is not the
// one signed into /admin, or a print shop that wants a file rather than a login.

import { readFile, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'

const DEV_PORT = 5273

/**
 * The address a phone can actually reach. `localhost` is useless here: the
 * whole point is to scan from a different device, so this has to be the
 * machine's address on the wifi everyone is joined to.
 */
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

/** Shared options with the browser: see app/components/QrImage.tsx. */
const SVG_OPTIONS = {
  type: 'svg',
  margin: 2,
  // High correction so it still scans after being printed, photocopied, or
  // shot off a projector screen at an angle.
  errorCorrectionLevel: 'H',
  width: 1024,
}

const explicit = process.argv[2]
const csvPath = process.argv[3]
let target = explicit

if (!target) {
  const host = lanAddress()
  if (!host) {
    console.error('No non-loopback IPv4 address found. Are you connected to a network?')
    console.error('Pass a URL instead: npm run qr https://your-domain/v/<eventId>')
    process.exit(1)
  }
  // No event id: `/` resolves to whichever event is currently open, so a code
  // generated before the event still works once voting starts.
  target = `http://${host}:${DEV_PORT}/`
}

// ---------------------------------------------------------------- one sheet

if (csvPath) {
  // Column order comes from codesToCsv in worker/codes.ts: code first.
  const codes = (await readFile(csvPath, 'utf8'))
    .split('\n')
    .slice(1)
    .map((line) => line.split(',')[0]?.trim())
    .filter(Boolean)

  if (codes.length === 0) {
    console.error(`No codes found in ${csvPath}. Is it the CSV from /admin?`)
    process.exit(1)
  }

  const base = new URL(target)
  const slips = []
  for (const code of codes) {
    const url = new URL(base)
    url.searchParams.set('c', code)
    slips.push({ code, svg: await QRCode.toString(url.toString(), SVG_OPTIONS) })
  }

  // A self-contained HTML sheet rather than a PDF: no extra dependency, and the
  // browser's print dialogue already handles paper size, margins and duplex.
  const sheet = `<!doctype html>
<meta charset="utf-8">
<title>Voting slips</title>
<style>
  @page { margin: 12mm; }
  body { margin: 0; font-family: system-ui, sans-serif; color: #000; background: #fff; }
  .slips { display: grid; grid-template-columns: repeat(3, 1fr); }
  .slip {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    text-align: center; padding: 10mm 4mm; border: 1px dashed #999;
    break-inside: avoid;
  }
  .slip svg { width: 38mm; height: 38mm; }
  .code { font-family: ui-monospace, monospace; font-size: 15pt; font-weight: 700; letter-spacing: 0.14em; }
  .hint { font-size: 7pt; line-height: 1.4; color: #444; }
</style>
<div class="slips">
${slips
  .map(
    (slip) => `  <div class="slip">
    ${slip.svg}
    <div class="code">${slip.code}</div>
    <div class="hint">Scan to score the demos. If scanning fails, type this code.</div>
  </div>`,
  )
  .join('\n')}
</div>
`

  const sheetPath = 'vote-slips.html'
  await writeFile(sheetPath, sheet)
  console.log(`\n  ${slips.length} slips written to ${sheetPath}`)
  console.log('  Open it in a browser and print. Each slip carries its own code.\n')
  process.exit(0)
}

// --------------------------------------------------------------- one code

const terminal = await QRCode.toString(target, { type: 'terminal', small: true })
const svg = await QRCode.toString(target, SVG_OPTIONS)

const outputPath = 'vote-qr.svg'
await writeFile(outputPath, svg)

console.log(terminal)
console.log(`  ${target}`)
console.log(`  written to ${outputPath}\n`)

if (!explicit) {
  console.log('  Scan from a phone on the same wifi. Run `npm run dev` first.')
  console.log('  For the real event pass the deployed URL:')
  console.log('    npm run qr https://your-domain/v/<eventId>')
}
console.log('  For one slip per attendee, add the code CSV from /admin:')
console.log('    npm run qr https://your-domain/v/<eventId> codes-<eventId>.csv\n')
