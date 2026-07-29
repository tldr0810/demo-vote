/// <reference path="../worker-configuration.d.ts" />
/// <reference path="../worker/env.d.ts" />

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[]
  }
}
