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

## Load test

```bash
# not part of `npm test` — it takes a minute and needs its own server
createdb aa_load
(cd backend && DATABASE_URL=postgresql://localhost/aa_load npm run migrate)
(cd backend && DATABASE_URL=postgresql://localhost/aa_load JWT_SECRET=loadtest_secret \
   PORT=3095 GUEST_IP_TOKEN_CAP=0 DB_POOL_MAX=15 LIVE_FEED_MAX_PARTICIPANTS=100000 npm run dev &)
python3 tests/loadtest.py
```

`DB_POOL_MAX=15` is deliberate: that is how many real PostgreSQL connections
Supavisor maintains on a Nano instance, so it is the production wall. Local
PostgreSQL is far faster than Nano, so absolute throughput does not transfer —
the *shape* of the curve and the failure behaviour do.

Two things the test has to get right, both learned the hard way:

- **Every request must do real work.** A vote is unique per (participant,
  question); reusing a pair returns 409 from a constraint violation, which is
  nothing like the write it stands in for. An early run was 90% 409s and the
  throughput figure it produced was meaningless. Votes are now cleared between
  levels and each worker walks a disjoint slice of the pair space.
- **The client can be the bottleneck.** Python threads with blocking HTTP
  saturate well before the server does, so figures above ~30 concurrent are a
  floor on server capacity, not a ceiling.

## Cross-replica test

Not part of `npm test` — it needs Redis and two backends.

```bash
redis-server --port 6399 --daemonize yes
createdb aa_replica
(cd backend && DATABASE_URL=postgresql://localhost/aa_replica npm run migrate)
for p in 3081 3082; do
  (cd backend && DATABASE_URL=postgresql://localhost/aa_replica JWT_SECRET=replica_secret \
     PORT=$p GUEST_IP_TOKEN_CAP=0 REDIS_URL=redis://localhost:6399 npm run dev &)
done
python3 tests/e2e-replicas.py
```

Listeners connect to **both** replicas, writes go through **one**, and every
assertion is that the other replica's listener saw it. Also checks that role
targeting survives the bus, that direct (mute) events reach only their target,
and that nothing is delivered twice — the publishing replica must not write
locally as well, since Redis echoes a publish back to its sender.

Re-run it with `REDIS_URL` unset and 8 of the 16 assertions fail. That is the
bug this exists to prevent, reproducible on demand, and worth doing once so the
failure is a thing you have seen rather than a paragraph you have read.

## Security probes

`security-probe.py` runs as part of `npm test`. Unlike the other suites it does
not assert that features work — it performs attacks and asserts each one is
refused. A `VULNERABLE` line is a real finding.

Covers privilege escalation (self-verifying an org, self-promoting to platform
admin, reassigning a session's host, featuring your own session), the anonymity
guarantee (feed, host view and CSV export must never name an anonymous author),
credit-economy bypasses (re-joining to refill, hammering the heartbeat), the
private-session boundary, cross-account access, and guest identity absorption.

Two real vulnerabilities were found this way and are now regression-covered:

- **Guest identity absorption.** `POST /auth/register` accepted a `guest_token`
  in the request body and migrated that guest's questions, participant row and
  credits to the new account. Guest tokens are not secret in practice — a guest
  JWT carries one in its payload, JWT payloads are base64 rather than encrypted,
  and the SSE endpoint puts that JWT in a URL query string where it reaches
  access logs and proxies. The token is now read from the caller's own verified
  JWT, so migrating a guest identity requires being able to authenticate as it.
- **Login account oracle.** Login returned before running bcrypt when no user
  matched, so an unknown address answered in ~1ms against ~100ms for a real one
  — the response time alone revealed whether an account existed. That is exactly
  what forgot-password goes to the trouble of hiding. Login now compares against
  a dummy hash so both paths cost the same; measured 210ms vs 209ms afterwards.

## Probing a deployed environment

```bash
python3 tests/prod-probe.py https://your-api.up.railway.app
```

Checks the boundaries that depend on the environment being configured correctly,
which the local suites cannot see: RLS is on in production and not locally,
traffic arrives through a proxy so rate limiters see a forwarded IP, and CORS,
HSTS and CSP come from real configuration rather than a test fixture.

It touches a live database, so it is built to leave nothing behind:

- sessions are created **unlisted or private, never public**, so nothing appears
  in Discover or in anyone's feed
- everything created is removed in a `finally` block — sessions deleted, then
  both accounts deleted through the real endpoint
- read-only environment checks run first, so a failure part-way still cleans up
- it writes only to its own data, and takes no moderation action on real sessions

Registration is rate limited to 10 per 15 minutes per IP, so wait between runs.

Dry-run it against localhost first. That is how the malformed-identifier 500 was
found — `?sessionId=not-a-uuid` returned a server error to any unauthenticated
caller, and would have buried real 500s once monitoring was added.

One trap worth knowing, because it bit this script: **HTTP/2 header names are
lower-case**. A local HTTP/1.1 server returns `Strict-Transport-Security`, a
deployed one returns `strict-transport-security`, and a case-sensitive dict
lookup silently finds neither. Header checks passed on localhost and reported
three false failures against production until `headers_of()` normalised them.
If a check passes locally and fails deployed, suspect the harness before the
server.
