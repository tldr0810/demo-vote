import { readFile, writeFile } from 'node:fs/promises'

// wrangler.toml ships with a placeholder database_id so the repository has no
// account-specific state in it. The deploy workflow resolves (or creates) the
// real D1 database and rewrites the placeholder just before deploying, which is
// what lets a fork deploy into its own Cloudflare account with no edits.

const [configPath, databaseId] = process.argv.slice(2)
const placeholder = '00000000-0000-4000-8000-000000000000'

if (!configPath || !databaseId) {
  throw new Error('Usage: node scripts/set-d1-database-id.mjs <wrangler.toml> <database-id>')
}
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId)) {
  throw new Error('The D1 database ID is not a valid UUID.')
}

const source = await readFile(configPath, 'utf8')
if (!source.includes(placeholder) && !source.includes(`database_id = "${databaseId}"`)) {
  throw new Error('The Wrangler config does not contain the expected D1 placeholder.')
}

await writeFile(configPath, source.replaceAll(placeholder, databaseId))
