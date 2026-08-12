"""Adversarial probes against a running backend.

Not a regression suite — these are attacks. Each one asserts that something a
malicious caller would try does NOT work. Findings here are real; passes mean
the attack was actually attempted against a live server and refused.

Three areas, chosen because they are where a bug would matter most:
  1. privilege escalation — can a caller grant themselves authority?
  2. anonymity — anonymous posting is a promise; can it be broken?
  3. the credit economy — can the anti-abuse limits be bypassed?
"""
import json, re, subprocess, time, urllib.error, urllib.request

API = "http://localhost:3094/api"
DB = "aa_probe"

findings, checks = [], []

def call(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = None if method == "GET" else json.dumps(body or {}).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=20) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                # Not every success is JSON — the CSV export is text/csv.
                return r.status, {"text": raw.decode(errors="replace")}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}

def sql(q):
    out = subprocess.run(["psql", DB, "-tAc", q], capture_output=True, text=True, check=True).stdout
    rows = [ln.strip() for ln in out.splitlines() if ln.strip()]
    return "\n".join(r for r in rows if not re.match(r"^(INSERT|UPDATE|DELETE|SELECT)\s+\d", r))

def blocked(label, condition, detail=""):
    """condition True == the attack was refused."""
    checks.append(condition)
    print(f"  [{'BLOCKED' if condition else 'VULNERABLE'}] {label}")
    if not condition:
        findings.append((label, detail))
        if detail:
            print(f"              → {detail}")

stamp = str(int(time.time()))
print("=== setup ===")
_, victim = call("POST", "/auth/register", body={
    "email": f"victim{stamp}@t.com", "username": f"victim{stamp}", "password": "password123"})
_, attacker = call("POST", "/auth/register", body={
    "email": f"attacker{stamp}@t.com", "username": f"attacker{stamp}", "password": "password123"})
V, A = victim["token"], attacker["token"]
vid, aid = victim["user"]["id"], attacker["user"]["id"]

_, org = call("POST", "/orgs", V, {"name": f"Victim Org {stamp}", "slug": f"vorg{stamp}"})
_, sess = call("POST", "/sessions", V, {"title": f"Victim Session {stamp}", "visibility": "public"})
sid = sess["id"]
call("POST", f"/sessions/{sid}/go-live", V)

_, priv = call("POST", "/sessions", V, {"title": f"Private {stamp}", "visibility": "private"})
call("POST", f"/sessions/{priv['id']}/go-live", V)
print(f"  victim owns org + public session + private session; attacker is a stranger")

# ── 1. Privilege escalation ──────────────────────────────────────────────────
print("\n=== 1. privilege escalation ===")

code, r = call("PATCH", f"/orgs/{org['id']}", V, {"is_verified": True, "name": "Still Mine"})
verified = sql(f"SELECT is_verified FROM organizations WHERE id = '{org['id']}'")
blocked("owner cannot self-verify their org (blue check)", verified == "f",
        f"is_verified became {verified!r} via PATCH /orgs/:id")

code, _ = call("PATCH", "/auth/me", A, {"is_platform_admin": True})
admin = sql(f"SELECT is_platform_admin FROM users WHERE id = '{aid}'")
blocked("user cannot make themselves a platform admin", admin == "f",
        f"is_platform_admin became {admin!r} via PATCH /auth/me")

code, _ = call("PATCH", f"/sessions/{sid}", A, {"title": "Hijacked"})
blocked("stranger cannot edit someone else's session", code in (403, 404))

code, _ = call("PATCH", f"/sessions/{sid}", V, {"host_id": aid})
owner = sql(f"SELECT host_id FROM sessions WHERE id = '{sid}'")
blocked("host_id cannot be reassigned via session update", owner == vid,
        "session ownership transferable through PATCH body")

code, _ = call("PATCH", f"/sessions/{sid}", V, {"is_featured": True})
feat = sql(f"SELECT is_featured FROM sessions WHERE id = '{sid}'")
blocked("host cannot feature their own session (admin-only)", feat == "f",
        "is_featured settable by the host, bypassing admin curation")

code, _ = call("POST", f"/orgs/{org['id']}/members", A, {"user_id": aid, "role": "owner"})
blocked("stranger cannot add themselves to an org", code in (403, 404))

code, _ = call("DELETE", f"/orgs/{org['id']}", A)
blocked("stranger cannot delete someone else's org", code in (403, 404))

code, _ = call("POST", f"/sessions/{sid}/moderators", A,
               {"user_id": aid, "can_hide": True, "can_remove": True})
blocked("stranger cannot make themselves a moderator", code in (403, 404))

# ── 2. Anonymity ─────────────────────────────────────────────────────────────
print("\n=== 2. anonymity ===")
call("POST", f"/sessions/{sid}/join", A, {})
code, anon_q = call("POST", "/questions", A,
                    {"session_id": sid, "body": "Anonymous question under test", "post_anonymously": True})
if code != 201:
    print(f"  (could not create anon question: {code} {anon_q})")
else:
    _, feed = call("GET", f"/questions?sessionId={sid}")
    row = next((q for q in feed["data"] if q["id"] == anon_q["id"]), None)
    blob = json.dumps(row or {})
    uname = attacker["user"]["username"]

    blocked("anon author's username absent from the public feed", uname not in blob,
            f"username leaked in feed payload")
    blocked("anon post shows an Anon label", (row or {}).get("author_username", "").startswith("Anon"),
            f"author_username was {(row or {}).get('author_username')!r}")
    blocked("anon post exposes no participant_id", (row or {}).get("participant_id") is None,
            "participant_id present — links the post to a mutable participant row")
    blocked("anon post exposes no author_is_muted", (row or {}).get("author_is_muted") is None,
            "author_is_muted present — moderation state can identify the author")

    # The host view is the most privileged non-admin view.
    _, hostfeed = call("GET", f"/questions?sessionId={sid}", V)
    hrow = next((q for q in hostfeed["data"] if q["id"] == anon_q["id"]), None)
    blocked("host cannot see the anon author either", uname not in json.dumps(hrow or {}),
            "host feed reveals the anonymous author")

    # CSV export is a bulk egress path and easy to forget.
    _, csv = call("GET", f"/sessions/{sid}/export", V)
    blocked("CSV export does not name the anon author", uname not in csv.get("text", ""),
            "anonymous author's username present in the export")

# ── 3. Credit economy ────────────────────────────────────────────────────────
print("\n=== 3. credit economy ===")
_, g = call("POST", "/auth/guest")
G = g["token"]
call("POST", f"/sessions/{sid}/join", G, {"guest_username": f"probe{stamp[-5:]}"})
start = int(sql(f"SELECT credits_remaining FROM session_participants "
                f"WHERE session_id='{sid}' AND guest_token='{g['guestToken']}'"))

call("POST", "/questions", G, {"session_id": sid, "body": "Spending one credit here now"})
spent = int(sql(f"SELECT credits_remaining FROM session_participants "
                f"WHERE session_id='{sid}' AND guest_token='{g['guestToken']}'"))
blocked("asking actually costs a credit", spent == start - 1, f"{start} -> {spent}")

# The obvious attack: re-join to refill.
call("POST", f"/sessions/{sid}/join", G, {"guest_username": f"probe{stamp[-5:]}"})
after = int(sql(f"SELECT credits_remaining FROM session_participants "
                f"WHERE session_id='{sid}' AND guest_token='{g['guestToken']}'"))
blocked("re-joining does not refill credits", after == spent, f"{spent} -> {after} on rejoin")

# Same, for a registered user.
call("POST", f"/sessions/{sid}/join", A, {})
a_before = int(sql(f"SELECT credits_remaining FROM session_participants "
                   f"WHERE session_id='{sid}' AND user_id='{aid}'"))
call("POST", f"/sessions/{sid}/join", A, {})
a_after = int(sql(f"SELECT credits_remaining FROM session_participants "
                  f"WHERE session_id='{sid}' AND user_id='{aid}'"))
blocked("registered re-join does not refill credits", a_after == a_before, f"{a_before} -> {a_after}")

# Heartbeat is the regen path; hammering it must not mint credits.
before_hb = int(sql(f"SELECT credits_remaining FROM session_participants "
                    f"WHERE session_id='{sid}' AND guest_token='{g['guestToken']}'"))
for _ in range(8):
    call("POST", f"/sessions/{sid}/heartbeat", G)
after_hb = int(sql(f"SELECT credits_remaining FROM session_participants "
                   f"WHERE session_id='{sid}' AND guest_token='{g['guestToken']}'"))
blocked("hammering heartbeat does not mint credits", after_hb <= before_hb + 1,
        f"{before_hb} -> {after_hb} after 8 rapid heartbeats")

# ── 4. Private session boundary ──────────────────────────────────────────────
print("\n=== 4. private session boundary ===")
pid = priv["id"]
code, _ = call("GET", f"/questions?sessionId={pid}", A)
blocked("stranger cannot read a private session's questions", code == 403)
code, _ = call("GET", f"/questions?sessionId={pid}")
blocked("anonymous cannot read a private session's questions", code == 403)
code, _ = call("GET", f"/questions/similar?sessionId={pid}&q=anything+at+all", A)
blocked("stranger cannot search a private session", code == 403)
code, _ = call("POST", f"/sessions/{pid}/join", A, {})
blocked("stranger cannot join a private session", code == 403)
code, _ = call("GET", f"/sessions/{priv['slug']}", A)
blocked("stranger cannot load a private session", code == 403)

# ── 5. IDOR ──────────────────────────────────────────────────────────────────
print("\n=== 5. cross-account access ===")
nid = sql(f"SELECT id FROM notifications WHERE user_id = '{vid}' LIMIT 1")
if nid:
    code, _ = call("DELETE", f"/notifications/{nid}", A)
    blocked("cannot delete another user's notification", code == 404)
else:
    print("  (no notification to test against)")

code, _ = call("GET", f"/orgs/{org['id']}/members", A)
blocked("stranger cannot list another org's members", code in (403, 404))
code, _ = call("GET", f"/sessions/{sid}/export", A)
blocked("stranger cannot export someone else's session", code in (403, 404))
code, _ = call("GET", f"/sessions/{sid}/moderators", A)
blocked("stranger cannot list session moderators", code in (403, 404))
code, _ = call("GET", "/admin/flags", A)
blocked("non-admin cannot reach admin routes", code == 403)

# ── 6. Guest identity absorption ─────────────────────────────────────────────
print("\n=== 6. guest identity absorption ===")
import base64
_, gv = call("POST", "/auth/guest")
call("POST", f"/sessions/{sid}/join", gv["token"], {"guest_username": f"vict{stamp[-5:]}"})
_, vq = call("POST", "/questions", gv["token"], {"session_id": sid, "body": "A question by the victim guest"})

# A guest JWT carries its guest_token in the payload, and JWT payloads are
# base64 rather than encrypted. The SSE endpoint puts that JWT in a URL query
# string, so it reaches access logs and proxies — treat it as obtainable.
pl = gv["token"].split(".")[1]
pl += "=" * ((4 - len(pl) % 4) % 4)
leaked = json.loads(base64.urlsafe_b64decode(pl))["guestToken"]

code, thief = call("POST", "/auth/register", body={
    "email": f"thief{stamp}@t.com", "username": f"thief{stamp}",
    "password": "password123", "guest_token": leaked})
still_theirs = sql(f"SELECT author_id FROM questions WHERE id = '{vq['id']}'")
blocked("a leaked guest_token cannot be claimed at registration",
        still_theirs != thief.get("user", {}).get("id"),
        "attacker absorbed the guest's questions, participant row and credits")

# The real upgrade path must still work: a guest holding their own token keeps
# their history when they create an account.
_, gu = call("POST", "/auth/guest")
call("POST", f"/sessions/{sid}/join", gu["token"], {"guest_username": f"upg{stamp[-5:]}"})
_, uq = call("POST", "/questions", gu["token"], {"session_id": sid, "body": "Question before upgrading"})
_, upgraded = call("POST", "/auth/register", gu["token"], {
    "email": f"upg{stamp}@t.com", "username": f"upg{stamp}", "password": "password123"})
migrated = sql(f"SELECT author_id FROM questions WHERE id = '{uq['id']}'")
blocked("(regression) a guest upgrading keeps their own questions",
        migrated == upgraded.get("user", {}).get("id"),
        "the fix broke the legitimate guest-to-account upgrade")

print(f"\n=== RESULT: {sum(checks)}/{len(checks)} attacks blocked ===")
for label, detail in findings:
    print(f"  VULNERABLE: {label}" + (f"\n              {detail}" if detail else ""))
raise SystemExit(0 if all(checks) else 1)
