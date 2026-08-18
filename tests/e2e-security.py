"""End-to-end checks for the high-risk paths on the hardening branch.

Covers the things that were only reasoned about: ban/mute enforcement (rewritten
into one query, and it fails open if wrong), token revocation on optionalAuth
routes, CSV export (a query that was fixed but never run), the live approval
queue over SSE, and upload magic-byte sniffing.

Run against a scratch database with the backend on :3099.
"""
import base64, json, subprocess, threading, time, urllib.request, urllib.error

API = "http://localhost:3099/api"
DB = "aa_e2e2"

def call(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body or {}).encode()
    try:
        with urllib.request.urlopen(req, data if method != "GET" else None, timeout=15) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw or b"{}")
            except Exception:
                return r.status, {"text": raw.decode(errors="replace")}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"text": raw.decode(errors="replace")}

def sql(q):
    return subprocess.run(["psql", DB, "-tAc", q],
                          capture_output=True, text=True, check=True).stdout.strip()

results = []
def check(label, got, want):
    good = got == want
    results.append(good)
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")

def section(t):
    print(f"\n=== {t} ===")

stamp = str(int(time.time()))

def new_host(tag):
    _, h = call("POST", "/auth/register", body={
        "email": f"{tag}{stamp}@t.com", "username": f"{tag}{stamp}", "password": "password123"})
    return h["token"]

def new_guest(sid, name):
    _, g = call("POST", "/auth/guest")
    call("POST", f"/sessions/{sid}/join", g["token"], {"guest_username": name})
    return g["token"]

def live_session(host, **extra):
    body = {"title": "T", "visibility": "public", "credits_per_user": 6}
    body.update(extra)
    _, s = call("POST", "/sessions", host, body)
    call("POST", f"/sessions/{s['id']}/go-live", host)
    return s["id"]

host = new_host("host")

# ── 1. Mute enforcement ──────────────────────────────────────────────────────
section("1. MUTE — consolidated ban/mute query")
sid = live_session(host)
gt = new_guest(sid, "muted_guy")
code, q = call("POST", "/questions", gt, {"session_id": sid, "body": "Before the mute lands"})
check("ask works before mute", code, 201)

pid = sql(f"SELECT id FROM session_participants WHERE session_id='{sid}' AND guest_username='muted_guy'")
code, r = call("PATCH", f"/sessions/{sid}/participants/{pid}/mute", host, {"mute": True})
check("mute succeeds", code, 200)

time.sleep(11)  # clear burst window so 429 cannot mask the 403
code, r = call("POST", "/questions", gt, {"session_id": sid, "body": "Should be blocked now"})
check("ask blocked when muted", code, 403)
check("mute message", r.get("error"), "You have been muted in this session")

# echo path uses the same helper
gt2 = new_guest(sid, "other_guy")
_, q2 = call("POST", "/questions", gt2, {"session_id": sid, "body": "A question to echo at"})
code, r = call("POST", f"/questions/{q2['id']}/echo", gt)
check("echo blocked when muted", code, 403)

# ── 2. Session ban ───────────────────────────────────────────────────────────
section("2. SESSION BAN — removed participant cannot come back")
gt3 = new_guest(sid, "banned_guy")
pid3 = sql(f"SELECT id FROM session_participants WHERE session_id='{sid}' AND guest_username='banned_guy'")
code, _ = call("DELETE", f"/sessions/{sid}/participants/{pid3}", host, {"reason": "spam"})
check("remove succeeds", code, 200)
check("session_bans row written",
      sql(f"SELECT count(*) FROM session_bans WHERE session_id='{sid}'"), "1")

# joinSession does not consult session_bans, so they can rejoin; the action must still be refused
code, _ = call("POST", f"/sessions/{sid}/join", gt3, {"guest_username": "banned_guy"})
check("rejoin allowed (join does not check session_bans)", code, 200)
code, r = call("POST", "/questions", gt3, {"session_id": sid, "body": "Sneaking back in here"})
check("ask blocked after removal", code, 403)
check("removal message", r.get("error"), "You have been removed from this session")

# ── 3. Platform ban (the dynamic OR branch) ──────────────────────────────────
section("3. PLATFORM BAN — user_id / guest_token / ip OR-clause")
gt4 = new_guest(sid, "platform_guy")
raw_token = sql(f"SELECT guest_token FROM session_participants WHERE session_id='{sid}' AND guest_username='platform_guy'")
admin_id = sql(f"SELECT id FROM users WHERE username='host{stamp}'")
sql(f"INSERT INTO platform_bans (guest_token, reason, banned_by) "
    f"VALUES ('{raw_token}', 'test ban', '{admin_id}')")
code, r = call("POST", "/questions", gt4, {"session_id": sid, "body": "Platform banned attempt"})
check("ask blocked by platform ban", code, 403)
check("suspension message", r.get("error"), "Your account has been suspended")

# expired bans must not block
sql(f"UPDATE platform_bans SET expires_at = NOW() - INTERVAL '1 hour' WHERE guest_token='{raw_token}'")
time.sleep(11)
code, _ = call("POST", "/questions", gt4, {"session_id": sid, "body": "After the ban expired"})
check("expired platform ban does not block", code, 201)

# ── 4. Token revocation on optionalAuth ──────────────────────────────────────
section("4. TOKEN REVOCATION — optionalAuth routes must honour it")
user_tok = new_host("revoke")
sid2 = live_session(host)
call("POST", f"/sessions/{sid2}/join", user_tok, {})
code, _ = call("POST", "/questions", user_tok, {"session_id": sid2, "body": "Posted before rotation"})
check("ask works with valid token", code, 201)

code, _ = call("PATCH", "/auth/me", user_tok,
               {"current_password": "password123", "new_password": "newpassword456"})
check("password change succeeds", code, 200)

# requireAuth route
code, _ = call("GET", "/auth/me", user_tok)
check("revoked token rejected on requireAuth", code, 401)

# optionalAuth route — this is the one that used to silently keep working
time.sleep(11)
code, r = call("POST", "/questions", user_tok, {"session_id": sid2, "body": "Posted after rotation"})
check("revoked token cannot post (optionalAuth)", code, 401)

code, r = call("GET", f"/questions?sessionId={sid2}")
check("feed still readable anonymously", code, 200)

# ── 5. CSV export ────────────────────────────────────────────────────────────
section("5. CSV EXPORT — query was broken, rewrite never run")
sid3 = live_session(host)
ge = new_guest(sid3, "csv_guy")
call("POST", "/questions", ge, {"session_id": sid3, "body": "=SUM(1+1) formula attempt"})
code, r = call("GET", f"/sessions/{sid3}/export", host)
check("export returns 200", code, 200)
body = r.get("text", "")
check("has CSV header", body.split("\n")[0] if body else "",
      "Question,Echoes,Status,Pinned,Author,Host Reply,Asked At")
check("formula prefixed with quote", "\"'=SUM(1+1)" in body, True)
check("author present", "csv_guy" in body, True)

# ── 6. Live approval queue over SSE ──────────────────────────────────────────
section("6. APPROVAL QUEUE — pending pushed to mods, hidden from audience")
sid4 = live_session(host, requires_approval=True)
events = {"host": [], "guest": []}

def listen(who, token, out):
    url = f"{API}/sessions/{sid4}/stream?token={token}"
    try:
        with urllib.request.urlopen(url, timeout=14) as r:
            for line in r:
                s = line.decode(errors="replace").strip()
                if s.startswith("event:"):
                    out.append(s.split(":", 1)[1].strip())
    except Exception:
        pass

ga = new_guest(sid4, "sse_guest")
th = threading.Thread(target=listen, args=("host", host, events["host"]), daemon=True)
tg = threading.Thread(target=listen, args=("guest", ga, events["guest"]), daemon=True)
th.start(); tg.start()
time.sleep(3)

_, pend = call("POST", "/questions", ga, {"session_id": sid4, "body": "Needs approval first"})
check("question starts pending", pend.get("status"), "pending")
time.sleep(3)
check("host received question:pending", "question:pending" in events["host"], True)
check("audience did NOT receive it", "question:pending" in events["guest"], False)

call("PATCH", f"/questions/{pend['id']}/approve", host)
time.sleep(3)
check("audience receives question:new on approve", "question:new" in events["guest"], True)

# ── 7. Upload magic-byte sniffing ────────────────────────────────────────────
section("7. UPLOAD — declared mime must match actual bytes")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

def upload(filename, content, mime, token):
    b = "----b" + stamp
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n").encode()
    body += content + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(API + "/upload", data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={b}")
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}

code, r = upload("ok.png", PNG, "image/png", host)
check("real PNG accepted", code, 200)
check("stored extension is .png", r.get("url", "").endswith(".png"), True)

# HTML disguised as a PNG — the stored-XSS vector
code, r = upload("evil.html", b"<html><script>alert(1)</script></html>", "image/png", host)
check("HTML claiming image/png rejected", code, 400)

# and the extension must never come from the filename
code, r = upload("evil.html", PNG, "image/png", host)
check("filename extension ignored", r.get("url", "").endswith(".png"), True)

section("FOLLOWING — an account feature, and the count says so")
# Guests hold a real users row, so requireAuth let one follow an org: the insert
# succeeded and the public follower count went up by one for someone the go-live
# fan-out deliberately skips and whose token dies with their browser.
fol_host = new_host("fol")
_, fol_org = call("POST", "/orgs", fol_host,
                  {"name": f"Radio {stamp}", "slug": f"radio{stamp}"})
org_id, org_slug = fol_org["id"], fol_org["slug"]
_, fg = call("POST", "/auth/guest")

check("guest cannot follow a user",
      call("POST", f"/users/fol{stamp}/follow", fg["token"])[0], 403)
check("guest cannot follow an org",
      call("POST", f"/orgs/{org_id}/follow", fg["token"])[0], 403)
check("anonymous cannot follow an org",
      call("POST", f"/orgs/{org_id}/follow")[0], 401)

# Rows written before the route was locked must not still inflate the count.
sql(f"INSERT INTO org_followers (org_id, user_id) "
    f"SELECT '{org_id}', id FROM users WHERE is_guest = true LIMIT 1 "
    f"ON CONFLICT DO NOTHING")
check("a stale guest row is present",
      sql(f"SELECT count(*) FROM org_followers f JOIN users u ON u.id=f.user_id "
          f"WHERE f.org_id='{org_id}' AND u.is_guest"), "1")
_, org_view = call("GET", f"/orgs/{org_slug}")
check("but the public count ignores it",
      (org_view.get("org") or org_view).get("follower_count"), 0)

# A registered follower still counts.
follower = new_host("folb")
check("registered follow accepted",
      call("POST", f"/orgs/{org_id}/follow", follower)[0], 200)
_, org_view2 = call("GET", f"/orgs/{org_slug}")
check("and is counted", (org_view2.get("org") or org_view2).get("follower_count"), 1)

print(f"\nRESULT: {sum(results)}/{len(results)} passed",
      "— ALL PASS" if all(results) else "— FAILURES PRESENT")
# Signal failure to the runner. Printing "FAILURES PRESENT" and exiting 0
# meant run.sh reported ALL SUITES PASSED with failing assertions in the
# output — the summary was only ever as honest as whoever read the lines
# above it.
raise SystemExit(0 if all(results) else 1)
