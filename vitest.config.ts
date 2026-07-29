import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

// Tests run inside workerd against a real local D1, not a mock. The one
// guarantee this project cannot get wrong — one code, one vote, even under
// concurrency — is enforced by SQLite, so it has to be tested against SQLite.
export default defineWorkersConfig(async () => {
  // Relative to the project root, which is vitest's cwd. Kept as a plain string
  // so this config needs no Node type dependency.
  const migrations = await readD1Migrations('./drizzle')

  return {
    test: {
      setupFiles: ['./tests/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              ADMIN_PASSWORD: 'test-admin-password',
              VOTE_HMAC_KEY: 'test-hmac-key-at-least-32-characters-long',
            },
          },
        },
      },
    },
  }
})
