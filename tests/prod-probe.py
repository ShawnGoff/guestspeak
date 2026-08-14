"""Probes a DEPLOYED environment.

The local suites run against a scratch database on localhost. Production differs
in ways those cannot see: row-level security is enabled there, traffic arrives
through a proxy so rate limiters see a forwarded IP, and the configuration is
real rather than a test fixture. This checks the boundaries that depend on that
environment being right.

Run:
    python3 tests/prod-probe.py https://your-api.up.railway.app

Safety, because this touches a live database:

  * Sessions are created UNLISTED or PRIVATE, never public, so nothing appears
    in Discover or in anyone's feed.
  * Everything created is removed in a finally block — sessions and org deleted,
    then both accounts deleted through the real endpoint.
  * No writes to anyone else's data. No moderation actions on real sessions.
  * Read-only checks run first, so a failure part-way still cleans up.

Fewer than ten accounts are registered, staying under the registration rate
limit. If you run it repeatedly, wait 15 minutes between runs.
"""
import json, sys, time, urllib.error, urllib.request

if len(sys.argv) < 2:
    sys.exit("usage: prod-probe.py https://your-api.up.railway.app")

BASE = sys.argv[1].rstrip("/")
API = BASE + "/api"

results, notes = [], []

def headers_of(resp):
    """Lower-case every header name.

    HTTP/2 requires lower-case header names, so a production response returns
    `strict-transport-security` where a local HTTP/1.1 one returns
    `Strict-Transport-Security`. dict() over the raw headers keeps whatever the
    server sent and lookups are case-sensitive, which made these checks pass on
    localhost and fail against a deployed host for no reason but the protocol.
    """
    return {k.lower(): v for k, v in dict(resp.headers).items()}


def call(method, path, token=None, body=None, origin=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if origin:
        req.add_header("Origin", origin)
    data = None if method == "GET" else json.dumps(body or {}).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw or b"{}"), headers_of(r)
            except json.JSONDecodeError:
                return r.status, {"text": raw.decode(errors="replace")}, headers_of(r)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}"), headers_of(e)
        except Exception:
            return e.code, {"text": raw.decode(errors="replace")[:200]}, headers_of(e)
    except Exception as e:
        return 0, {"error": f"{type(e).__name__}: {e}"}, {}

def check(label, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}")
    if not ok and detail:
        print(f"         → {detail}")

stamp = str(int(time.time()))
created = {"sessions": [], "orgs": [], "tokens": []}

print(f"probing {BASE}\n")

# ── Read-only: environment configuration ─────────────────────────────────────
print("=== environment (creates nothing) ===")
code, body, hdrs = call("GET", "/auth/me")
check("unauthenticated request is refused", code == 401, f"got {code}")

_, _, h = call("GET", "/auth/me", origin="https://evil-attacker-site.example")
acao = h.get("access-control-allow-origin", "")
check("CORS does not echo a hostile origin",
      "evil-attacker-site" not in acao,
      f"Access-Control-Allow-Origin was {acao!r} — any site could read authenticated responses")
check("CORS returns a configured origin", acao.startswith("http"), f"got {acao!r}")

hsts = h.get("strict-transport-security", "")
check("HSTS is set", "max-age" in hsts, f"got {hsts!r}")
check("x-powered-by is stripped", "x-powered-by" not in h,
      f"leaks {h.get('x-powered-by')!r}")
check("CSP is set on the API", "content-security-policy" in h, "no CSP header")

code, body, _ = call("POST", "/auth/login", body=None)
code, body, _ = call("GET", "/nope-does-not-exist")
check("unknown routes answer in JSON, not HTML",
      isinstance(body, dict) and "error" in body and "<!DOCTYPE" not in str(body),
      f"got {str(body)[:80]}")

code, body, _ = call("GET", "/questions?sessionId=not-a-uuid")
check("a malformed id is a client error, not a 500", code < 500, f"got {code}")

try:
    # ── Authenticated boundaries ─────────────────────────────────────────────
    print("\n=== boundaries (creates data, cleaned up below) ===")
    _, victim, _ = call("POST", "/auth/register", body={
        "email": f"probe-v-{stamp}@example.invalid",
        "username": f"probev{stamp}", "password": "ProbePassword!234"})
    _, attacker, _ = call("POST", "/auth/register", body={
        "email": f"probe-a-{stamp}@example.invalid",
        "username": f"probea{stamp}", "password": "ProbePassword!234"})

    if "token" not in victim or "token" not in attacker:
        print(f"  (registration refused — probably the rate limit; wait 15 minutes)")
        print(f"   victim: {str(victim)[:120]}")
        raise SystemExit(1)

    V, A = victim["token"], attacker["token"]
    created["tokens"] += [V, A]
    vid, aid = victim["user"]["id"], attacker["user"]["id"]

    # Unlisted, never public: it must not surface in Discover for real users.
    _, sess, _ = call("POST", "/sessions", V, {
        "title": f"[probe] {stamp}", "visibility": "unlisted"})
    _, priv, _ = call("POST", "/sessions", V, {
        "title": f"[probe private] {stamp}", "visibility": "private"})
    created["sessions"] += [s["id"] for s in (sess, priv) if "id" in s]

    code, _, _ = call("PATCH", f"/sessions/{sess['id']}", A, {"title": "hijacked"})
    check("a stranger cannot edit another user's session", code in (403, 404), f"got {code}")

    code, _, _ = call("GET", f"/questions?sessionId={priv['id']}", A)
    check("a stranger cannot read a private session", code == 403, f"got {code}")

    code, _, _ = call("GET", f"/questions?sessionId={priv['id']}")
    check("anonymous cannot read a private session", code == 403, f"got {code}")

    code, _, _ = call("GET", f"/sessions/{sess['id']}/export", A)
    check("a stranger cannot export another user's session", code in (403, 404), f"got {code}")

    code, _, _ = call("GET", "/admin/flags", A)
    check("a normal account cannot reach admin routes", code == 403, f"got {code}")

    code, _, _ = call("PATCH", "/auth/me", A, {"is_platform_admin": True})
    _, me, _ = call("GET", "/auth/me", A)
    check("a user cannot promote themselves to admin",
          not me.get("is_platform_admin"), "is_platform_admin was accepted")

    # Revocation has to work through the proxy and against the real database.
    _, _, _ = call("PATCH", "/auth/me", V, {
        "current_password": "ProbePassword!234", "new_password": "ProbePassword!567"})
    code, _, _ = call("GET", "/auth/me", V)
    check("changing a password revokes existing tokens", code == 401, f"got {code}")

    _, relogin, _ = call("POST", "/auth/login", body={
        "email": f"probe-v-{stamp}@example.invalid", "password": "ProbePassword!567"})
    if "token" in relogin:
        V = relogin["token"]
        created["tokens"][0] = V
        check("the new password works", True)
    else:
        check("the new password works", False, str(relogin)[:120])

finally:
    # ── Cleanup ──────────────────────────────────────────────────────────────
    print("\n=== cleanup ===")
    for sid in created["sessions"]:
        code, _, _ = call("DELETE", f"/sessions/{sid}", created["tokens"][0] if created["tokens"] else None)
        print(f"  session {sid[:8]} deleted: {code}")
    for oid in created["orgs"]:
        call("DELETE", f"/orgs/{oid}", created["tokens"][0])
    pw = {"password": "ProbePassword!567"}
    for i, tok in enumerate(created["tokens"]):
        body = pw if i == 0 else {"password": "ProbePassword!234"}
        code, resp, _ = call("DELETE", "/auth/me", tok, body)
        print(f"  account {i + 1} deleted: {code}" + ("" if code == 200 else f" {str(resp)[:80]}"))

print(f"\n=== RESULT: {sum(results)}/{len(results)} passed ===")
for n in notes:
    print(f"  note: {n}")
raise SystemExit(0 if all(results) else 1)
