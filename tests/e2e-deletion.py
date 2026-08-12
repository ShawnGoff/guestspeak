"""Account deletion — App Store Guideline 5.1.1(v) and GDPR erasure.

Deletion is anonymisation, not DELETE, so the interesting assertions are about
what *survives*: other people's questions must remain, moderation history must
stay intact, and a banned user must not shed their ban by leaving.
"""
import json, subprocess, time, urllib.error, urllib.request

API = "http://localhost:3095/api"
DB = "aa_del"

def call(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = None if method == "GET" else json.dumps(body or {}).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=20) as r:
            txt = r.read()
            try:
                return r.status, json.loads(txt or b"{}")
            except Exception:
                return r.status, {"text": txt.decode(errors="replace")[:200]}
    except urllib.error.HTTPError as e:
        txt = e.read()
        try:
            return e.code, json.loads(txt or b"{}")
        except Exception:
            return e.code, {"text": txt.decode(errors="replace")[:200]}

def sql(q):
    return subprocess.run(["psql", DB, "-tAc", q],
                          capture_output=True, text=True, check=True).stdout.strip()

results = []
def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")

def section(t): print(f"\n=== {t} ===")

stamp = str(int(time.time()))

def mkuser(tag):
    _, u = call("POST", "/auth/register", body={
        "email": f"{tag}{stamp}@t.com", "username": f"{tag}{stamp}", "password": "password123"})
    return u["token"], u["user"]["id"], u["user"]["username"]

# ── Setup: a host with a session, and an attendee who asks a question ────────
section("SETUP")
H, host_id, host_name = mkuser("del")
A, attendee_id, attendee_name = mkuser("att")

_, s = call("POST", "/sessions", H, {"title": f"Deletion {stamp}", "visibility": "public",
                                     "credits_per_user": 6})
sid = s["id"]
call("POST", f"/sessions/{sid}/go-live", H)
call("POST", f"/sessions/{sid}/join", A, {})
_, aq = call("POST", "/questions", A, {"session_id": sid, "body": "Attendee question that must survive"})

# The departing user also asks one, so we can watch their byline disappear.
call("POST", f"/sessions/{sid}/join", H, {})
_, hq = call("POST", "/questions", H, {"session_id": sid, "body": "Question from the departing user"})
print(f"  host={host_name} attendee={attendee_name} session={sid}")

# ── Guard rails ──────────────────────────────────────────────────────────────
section("1. GUARDS — password required, wrong password refused")
code, r = call("DELETE", "/auth/me", H, {})
check("missing password rejected", code, 400)
code, r = call("DELETE", "/auth/me", H, {"password": "wrongpassword"})
check("wrong password rejected", code, 400)
check("account still alive", sql(f"SELECT deleted_at IS NULL FROM users WHERE id='{host_id}'"), "t")

# ── Sole ownership of a shared org blocks deletion ───────────────────────────
section("2. SHARED ORG — deletion refused with instructions")
_, org = call("POST", "/orgs", H, {"name": f"Shared {stamp}", "slug": f"shared{stamp}"})
call("POST", f"/orgs/{org['id']}/members", H, {"user_id": attendee_id, "role": "admin"})
code, r = call("DELETE", "/auth/me", H, {"password": "password123"})
check("blocked while sole owner of a shared org", code, 409)
check("message names the org", f"Shared {stamp}" in str(r.get("error", "")), True)

# Removing the other member makes it a solo org, which may be cleaned up freely.
call("DELETE", f"/orgs/{org['id']}/members/{attendee_id}", H)

# ── The deletion itself ──────────────────────────────────────────────────────
section("3. DELETE")
code, r = call("DELETE", "/auth/me", H, {"password": "password123"})
check("deletion succeeds", code, 200)

row = sql(f"SELECT COALESCE(email,'~') || '|' || COALESCE(username,'~') || '|' || "
          f"COALESCE(password_hash,'~') || '|' || COALESCE(code_prefix,'~') || '|' || "
          f"COALESCE(ip_address::text,'~') || '|' || is_platform_admin::text || '|' || "
          f"(deleted_at IS NOT NULL)::text FROM users WHERE id='{host_id}'")
check("personal fields all nulled + flagged", row, "~|~|~|~|~|false|true")
check("solo org removed", sql(f"SELECT count(*) FROM organizations WHERE id='{org['id']}'"), "0")

# ── What must survive ────────────────────────────────────────────────────────
section("4. OTHER PEOPLE'S CONTENT SURVIVES")
check("session still exists", sql(f"SELECT count(*) FROM sessions WHERE id='{sid}'"), "1")
check("attendee's question survives",
      sql(f"SELECT count(*) FROM questions WHERE id='{aq['id']}'"), "1")
check("attendee's byline intact",
      sql(f"SELECT author_display_name FROM questions WHERE id='{aq['id']}'"), attendee_name)
check("departing user's byline scrubbed",
      sql(f"SELECT COALESCE(author_display_name,'~') FROM questions WHERE id='{hq['id']}'"), "~")

_, feed = call("GET", f"/questions?sessionId={sid}")
bylines = sorted(q["author_username"] for q in feed["data"])
check("old username gone from the public feed", host_name in bylines, False)
check("attendee still named in the feed", attendee_name in bylines, True)

# ── Access is revoked ────────────────────────────────────────────────────────
section("5. ACCESS REVOKED")
code, _ = call("GET", "/auth/me", H)
check("old token rejected", code, 401)
code, _ = call("POST", "/auth/login", body={"email": f"del{stamp}@t.com", "password": "password123"})
check("cannot log back in by email", code, 401)
code, _ = call("POST", "/auth/login", body={"email": host_name, "password": "password123"})
check("cannot log back in by username", code, 401)
code, r = call("GET", f"/users/{host_name}", A)
check("profile no longer resolves", code, 404)
code, r = call("GET", f"/auth/users/search?q={host_name[:6]}", A)
check("absent from user search", any(u.get("username") == host_name for u in r if isinstance(r, list)), False)

# The freed username may be claimed again.
code, _ = call("POST", "/auth/register",
               body={"email": f"reuse{stamp}@t.com", "username": host_name, "password": "password123"})
check("username released for reuse", code, 201)

# ── Bans are not shed by leaving ─────────────────────────────────────────────
section("6. BAN EVASION")
B, banned_id, banned_name = mkuser("ban")
admin_id = sql(f"SELECT id FROM users WHERE username='{attendee_name}'")
sql(f"UPDATE users SET is_platform_admin=true WHERE id='{admin_id}'")
sql(f"INSERT INTO platform_bans (user_id, reason, banned_by) "
    f"VALUES ('{banned_id}', 'test', '{admin_id}')")
call("DELETE", "/auth/me", B, {"password": "password123"})
check("ban survives the account deletion",
      sql(f"SELECT count(*) FROM platform_bans WHERE user_id='{banned_id}'"), "1")

# ── Deleted users cannot be reinstated by id ─────────────────────────────────
section("7. NO REINSTATEMENT BY ID")
_, s2 = call("POST", "/sessions", A, {"title": f"Mod {stamp}", "visibility": "public"})
code, r = call("POST", f"/sessions/{s2['id']}/moderators", A, {"user_id": host_id})
check("cannot be added as a moderator", code, 404)

print(f"\nRESULT: {sum(results)}/{len(results)} passed",
      "— ALL PASS" if all(results) else "— FAILURES PRESENT")
