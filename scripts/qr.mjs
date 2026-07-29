// Builds the QR code attendees scan.
//
//   npm run qr                          # local dev, LAN address, for testing
//   npm run qr https://vote.example.com/v/evt_abc123   # the real one, for printing
//
// Prints a scannable block in the terminal and writes an SVG next to it, since
// the printed slip and the running-order slide both need a vector.

import { writeFile } from 'node:fs/promises'
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

const explicit = process.argv[2]
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

const terminal = await QRCode.toString(target, { type: 'terminal', small: true })
const svg = await QRCode.toString(target, {
  type: 'svg',
  margin: 2,
  // High correction so it still scans after being printed, photocopied, or
  // shot off a projector screen at an angle.
  errorCorrectionLevel: 'H',
  width: 1024,
})

const outputPath = 'vote-qr.svg'
await writeFile(outputPath, svg)

console.log(terminal)
console.log(`  ${target}`)
console.log(`  written to ${outputPath}\n`)

if (!explicit) {
  console.log('  Scan from a phone on the same wifi. Run `npm run dev` first.')
  console.log('  For the real event pass the deployed URL:')
  console.log('    npm run qr https://your-domain/v/<eventId>\n')
}
