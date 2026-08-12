# End-to-end tests

```bash
npm test          # from the repo root
```

Needs a local PostgreSQL that the current user can `createdb` on. Each suite gets
a throwaway database, runs the real backend against it, and drops it afterwards.
Nothing here touches a deployed environment.

## Why these exist

Every serious bug found in the August 2026 hardening pass was invisible to code
review and visible immediately on execution:

| Bug | Symptom |
|---|---|
| CSV export referenced an undefined alias | Every export 500'd |
| Credit heartbeat never closed a `GREATEST(` | Every heartbeat 500'd, silently |
| Question status update could not resolve a parameter type | All moderation actions 500'd |
| `requires_approval` missing from the INSERT | Returned 200, silently ignored |
| New guests bounced to `/login` by a heartbeat 401 | Looked like intended behaviour |

Four of the five were masked by a client that swallowed the error. Reading the
code did not surface them; calling the endpoint surfaced them instantly.

## The suites

| Suite | Covers |
|---|---|
| `e2e-smoke.py` | Calls every endpoint once. Asserts only that nothing returns 5xx — the cheapest guard against SQL that has never run. |
| `e2e-verify.py` | Closed-session echoes, credit refunds on rejected questions, status persistence. |
| `e2e-security.py` | Mute, session bans, platform bans and expiry, token revocation on both auth paths, CSV export, the approval queue over real SSE, upload magic-byte sniffing. |
| `e2e-scale.py` | Feed-mode threshold, SSE 409 fallback, feed cache invalidation, moderator credit exemption, guest regen ceiling. |

`e2e-smoke.py` is the one to extend when adding an endpoint — one line, and the
whole class of never-executed-SQL bugs stays closed.

## Notes

- Suites run sequentially; each needs its own server configuration.
- `e2e-scale.py` runs with `LIVE_FEED_MAX_PARTICIPANTS=2` so the polling
  threshold can be crossed with three guests rather than four hundred.
- A `[FAIL]` line means an assertion failed. `server SQL/unhandled errors` counts
  anything the backend logged — that should always be `0`, including on runs
  where every assertion passes, since a swallowed 500 is exactly what these
  suites exist to catch.
