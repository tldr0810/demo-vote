// Post-deploy smoke test. Answers one question: is this deployment safe to
// hand a room full of people?
//
//   node scripts/smoke.mjs                       # against local dev
//   node scripts/smoke.mjs https://your.workers.dev

const base = (process.argv[2] ?? 'http://localhost:5273').replace(/\/$/, '')

let failures = 0

function check(name, passed, detail = '') {
  const mark = passed ? 'ok  ' : 'FAIL'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures += 1
}

async function main() {
  console.log(`smoke: ${base}\n`)

  const health = await fetch(`${base}/api/health`)
  const healthBody = await health.json().catch(() => ({}))
  check('health responds', health.status === 200, `status ${health.status}`)
  // A deployment missing either secret cannot authenticate anyone. It would
  // still serve a login page, so this has to be asserted rather than eyeballed.
  check('ADMIN_PASSWORD is configured', healthBody?.configured?.adminPassword === true)
  check('VOTE_HMAC_KEY is configured', healthBody?.configured?.hmacKey === true)

  const shell = await fetch(base)
  const html = await shell.text()
  check('app shell is served', shell.status === 200 && html.includes('<div id="root">'))

  // The three ways someone could read the tally without permission.
  const ballot = await fetch(`${base}/api/ballot`)
  check('ballot requires a redeemed code', ballot.status === 401, `status ${ballot.status}`)

  const adminState = await fetch(`${base}/api/admin/state`)
  check('admin state requires a session', adminState.status === 401, `status ${adminState.status}`)

  const badLogin = await fetch(`${base}/api/admin/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'definitely-not-the-password' }),
  })
  check(
    'a wrong admin password is rejected',
    badLogin.status === 401 || badLogin.status === 429,
    `status ${badLogin.status}`,
  )

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`smoke run failed: ${error.message}`)
  process.exit(1)
})
