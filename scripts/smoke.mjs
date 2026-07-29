// Post-deploy smoke test. Answers one question: is this deployment safe to
// hand a room full of people?
//
//   node scripts/smoke.mjs                       # against local dev
//   node scripts/smoke.mjs https://your.workers.dev

import { readFile } from 'node:fs/promises'

const base = (process.argv[2] ?? 'http://localhost:5273').replace(/\/$/, '')

let failures = 0

function check(name, passed, detail = '') {
  const mark = passed ? 'ok  ' : 'FAIL'
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures += 1
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The hashed entry bundle this working tree built, if it has built one. */
async function expectedBundle() {
  try {
    const html = await readFile(new URL('../dist/client/index.html', import.meta.url), 'utf8')
    return html.match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Waits until the deployment is serving the build in dist/, then returns.
 *
 * `wrangler deploy` returns before the new version is answering everywhere, so
 * asserting immediately tests the version being replaced. That is not a
 * hypothetical: the run that added the D1 check to /api/health failed its own
 * smoke test, because the deployment it reached was the one without it, and the
 * failure looked exactly like a broken database binding.
 *
 * Skipped when the target has no hashed bundle to compare, which is how a dev
 * server looks.
 */
async function waitForBuild(expected) {
  if (!expected) return true

  const deadlineMs = 120_000
  const startedAt = Date.now()
  let sawHashedBundle = false

  while (Date.now() - startedAt < deadlineMs) {
    const html = await fetch(base, { cache: 'no-store' })
      .then((response) => response.text())
      .catch(() => '')

    if (html.includes(expected)) {
      const waited = Math.round((Date.now() - startedAt) / 1000)
      check('the deployment is serving this build', true, waited > 0 ? `after ${waited}s` : '')
      return true
    }
    if (!/assets\/index-[A-Za-z0-9_-]+\.js/.test(html)) {
      // No hashed bundle at all: a dev server, so there is nothing to wait for.
      return true
    }
    sawHashedBundle = true
    await sleep(3000)
  }

  check(
    'the deployment is serving this build',
    false,
    sawHashedBundle
      ? `still serving another build after ${deadlineMs / 1000}s; every check below may be testing the previous version`
      : 'no build found to compare',
  )
  return false
}

async function main() {
  console.log(`smoke: ${base}\n`)

  // Before anything else, so a propagation lag is reported as a propagation lag
  // rather than as whichever assertion the old version happens to fail.
  await waitForBuild(await expectedBundle())

  const health = await fetch(`${base}/api/health`)
  const healthBody = await health.json().catch(() => ({}))
  check('health responds', health.status === 200, `status ${health.status}`)
  // A deployment missing either secret cannot authenticate anyone. It would
  // still serve a login page, so this has to be asserted rather than eyeballed.
  check('ADMIN_PASSWORD is configured', healthBody?.configured?.adminPassword === true)
  check('VOTE_HMAC_KEY is configured', healthBody?.configured?.hmacKey === true)
  // The D1 binding is rewritten at deploy time by set-d1-database-id.mjs, so a
  // deployment can be perfectly configured and still be pointed at no database.
  check('D1 answers a query', healthBody?.database === true)

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
