/// <reference path="../worker-configuration.d.ts" />

// Bindings declared in wrangler.toml are generated into worker-configuration.d.ts
// by `wrangler types`. Secrets are not in that file — they are never committed —
// so they are merged into the global Env interface here.
//
// Both are optional at the type level because a fresh deployment can boot
// without them. Every route that needs one fails closed with 503 NOT_CONFIGURED
// rather than silently degrading into an unauthenticated app.
interface Env {
  /** Unlocks /admin. */
  ADMIN_PASSWORD?: string
  /** Signs voter and admin session cookies. At least 32 random characters. */
  VOTE_HMAC_KEY?: string
}
