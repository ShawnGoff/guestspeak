"""Calls every API endpoint at least once with valid input.

Today's worst bugs were all queries that had simply never run: the CSV export
referenced an undefined alias, the credit heartbeat never closed a paren, and the
question status update could not resolve a parameter type. None were visible by
reading the code; all three surfaced the instant the endpoint was called.

So this asserts something deliberately shallow: no endpoint returns 5xx. It is
not checking business logic — the other suites do that — it is checking that
every line of SQL in the app has been executed at least once.
"""
import base64, json, subprocess, time, urllib.error, urllib.request

API = "http://localhost:3096/api"
DB = "aa_smoke"

def call(method, path, token=None, body=None, raw=False):
    req = urllib.request.Request(API + path, method=method)
    if not raw:
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
    except Exception as e:
        return 0, {"error": f"transport: {e}"}

def sql(q):
    return subprocess.run(["psql", DB, "-tAc", q],
                          capture_output=True, text=True, check=True).stdout.strip()

calls, failures = [], []
def hit(label, method, path, token=None, body=None, allow=None):
    """Any 5xx is a failure. 4xx is fine — it still executed the handler."""
    code, resp = call(method, path, token, body)
    calls.append(label)
    bad = code >= 500 or code == 0
    if allow and code in allow:
        bad = False
    if bad:
        failures.append((label, method, path, code, str(resp)[:160]))
        print(f"  [5xx] {label}: {code} {str(resp)[:110]}")
    return code, resp

stamp = str(int(time.time()))
print("=== setup ===")
_, host = call("POST", "/auth/register", body={
    "email": f"h{stamp}@t.com", "username": f"h{stamp}", "password": "password123"})
_, other = call("POST", "/auth/register", body={
    "email": f"o{stamp}@t.com", "username": f"o{stamp}", "password": "password123"})
H, O = host["token"], other["token"]
host_id, other_id = host["user"]["id"], other["user"]["id"]

# Promote the host to platform admin so the admin routes are reachable.
sql(f"UPDATE users SET is_platform_admin = true WHERE id = '{host_id}'")

_, guest = call("POST", "/auth/guest")
G = guest["token"]
print(f"host={host['user']['username']} other={other['user']['username']} guest=ok")

# ── auth ─────────────────────────────────────────────────────────────────────
print("\n=== auth ===")
hit("register dup (409 expected)", "POST", "/auth/register",
    body={"email": f"h{stamp}@t.com", "username": f"h{stamp}", "password": "password123"})
hit("login", "POST", "/auth/login", body={"email": f"h{stamp}@t.com", "password": "password123"})
hit("guest token", "POST", "/auth/guest")
hit("get me", "GET", "/auth/me", H)
hit("patch me (code_prefix)", "PATCH", "/auth/me", H, {"code_prefix": "SMOK"})
hit("forgot-password", "POST", "/auth/forgot-password", body={"email": f"h{stamp}@t.com"})
hit("reset-password (400 expected)", "POST", "/auth/reset-password",
    body={"token": "00000000-0000-0000-0000-000000000000", "password": "password123"})
hit("check-username", "GET", f"/auth/check-username?username=h{stamp}")
hit("users/search", "GET", "/auth/users/search?q=h", H)

# ── orgs ─────────────────────────────────────────────────────────────────────
print("\n=== orgs ===")
code, org = hit("create org", "POST", "/orgs", H, {"name": f"Org {stamp}", "slug": f"org{stamp}"})
org_id = org.get("id")
org_slug = org.get("slug", f"org{stamp}")
hit("orgs mine", "GET", "/orgs/mine", H)
hit("orgs search", "GET", "/orgs/search?q=Org")
hit("get org by slug", "GET", f"/orgs/{org_slug}", H)
if org_id:
    hit("patch org", "PATCH", f"/orgs/{org_id}", H, {"description": "smoke"})
    hit("list members", "GET", f"/orgs/{org_id}/members", H)
    hit("add member", "POST", f"/orgs/{org_id}/members", H, {"user_id": other_id, "role": "admin"})
    hit("follow org", "POST", f"/orgs/{org_id}/follow", O)
    hit("unfollow org", "DELETE", f"/orgs/{org_id}/follow", O)
    hit("remove member", "DELETE", f"/orgs/{org_id}/members/{other_id}", H)

# ── users ────────────────────────────────────────────────────────────────────
print("\n=== users ===")
uname = other["user"]["username"]
hit("users search", "GET", "/users/search?q=o", H)
hit("user profile", "GET", f"/users/{uname}", H)
hit("followers", "GET", f"/users/{uname}/followers", H)
hit("following", "GET", f"/users/{uname}/following", H)
hit("follow user", "POST", f"/users/{uname}/follow", H)
hit("unfollow user", "DELETE", f"/users/{uname}/follow", H)

# ── sessions ─────────────────────────────────────────────────────────────────
print("\n=== sessions ===")
code, sess = hit("create session", "POST", "/sessions", H, {
    "title": f"Smoke {stamp}", "visibility": "public", "credits_per_user": 6,
    "city": "Austin", "lat": 30.27, "lng": -97.74, "requires_approval": False})
sid, slug = sess.get("id"), sess.get("slug")
join_code = sess.get("join_code")
hit("list sessions", "GET", "/sessions")
hit("sessions mine", "GET", "/sessions/mine", H)
hit("sessions attended", "GET", "/sessions/attended", H)
hit("session by code", "GET", f"/sessions/code/{join_code}", H)
hit("session by slug", "GET", f"/sessions/{slug}", H)
hit("patch session", "PATCH", f"/sessions/{sid}", H, {"description": "smoke run"})
hit("go live", "POST", f"/sessions/{sid}/go-live", H)
hit("join (guest)", "POST", f"/sessions/{sid}/join", G, {"guest_username": f"sg{stamp[-5:]}"})
hit("join (registered)", "POST", f"/sessions/{sid}/join", O, {})
hit("heartbeat", "POST", f"/sessions/{sid}/heartbeat", G)
hit("report session", "POST", f"/sessions/{sid}/report", O, {"reason": "spam", "details": "smoke"})

# ── questions ────────────────────────────────────────────────────────────────
print("\n=== questions ===")
code, q = hit("create question", "POST", "/questions", G,
              {"session_id": sid, "body": "Smoke test question body"})
qid = q.get("id")
hit("list questions", "GET", f"/questions?sessionId={sid}")
hit("similar", "GET", f"/questions/similar?sessionId={sid}&q=smoke%20test%20question")
hit("echo", "POST", f"/questions/{qid}/echo", O)
hit("flag", "POST", f"/questions/{qid}/flag", O, {"reason": "spam"})
hit("status -> starred", "PATCH", f"/questions/{qid}/status", H, {"status": "starred"})
hit("status -> answered", "PATCH", f"/questions/{qid}/status", H, {"status": "answered"})
hit("status -> hidden", "PATCH", f"/questions/{qid}/status", H, {"status": "hidden"})
hit("status -> new", "PATCH", f"/questions/{qid}/status", H, {"status": "new"})
hit("pin", "PATCH", f"/questions/{qid}/pin", H)
hit("spotlight", "PATCH", f"/questions/{qid}/spotlight", H)
hit("reply", "PATCH", f"/questions/{qid}/reply", H, {"reply": "Answered on stage."})

# ── moderators ───────────────────────────────────────────────────────────────
print("\n=== moderators ===")
hit("add moderator", "POST", f"/sessions/{sid}/moderators", H,
    {"user_id": other_id, "can_mark_answered": True, "can_star": True,
     "can_hide": True, "can_mute": True, "can_remove": True, "can_approve": True})
hit("list moderators", "GET", f"/sessions/{sid}/moderators", H)
hit("update moderator", "PATCH", f"/sessions/{sid}/moderators/{other_id}", H, {"can_star": False})
pid = sql(f"SELECT id FROM session_participants WHERE session_id='{sid}' "
          f"AND guest_username='sg{stamp[-5:]}'")
if pid:
    hit("mute participant", "PATCH", f"/sessions/{sid}/participants/{pid}/mute", H, {"mute": True})
    hit("unmute participant", "PATCH", f"/sessions/{sid}/participants/{pid}/mute", H, {"mute": False})
hit("remove moderator", "DELETE", f"/sessions/{sid}/moderators/{other_id}", H)

# ── approval flow (separate session) ─────────────────────────────────────────
print("\n=== approval flow ===")
_, s2 = call("POST", "/sessions", H, {"title": f"Appr {stamp}", "visibility": "public",
                                      "credits_per_user": 6, "requires_approval": True})
call("POST", f"/sessions/{s2['id']}/go-live", H)
_, g2 = call("POST", "/auth/guest")
call("POST", f"/sessions/{s2['id']}/join", g2["token"], {"guest_username": f"ap{stamp[-5:]}"})
_, pq = call("POST", "/questions", g2["token"],
             {"session_id": s2["id"], "body": "Pending smoke question"})
hit("approve question", "PATCH", f"/questions/{pq['id']}/approve", H)

# ── notifications ────────────────────────────────────────────────────────────
print("\n=== notifications ===")
# Generate a real notification first: a host reply notifies the question's
# author, but only when the author is a registered user other than the replier.
# Replying to the guest's question above produced nothing, which left the :id
# routes unexercised — exactly the gap this suite exists to close.
call("POST", f"/sessions/{s2['id']}/join", O, {})  # must be a participant to ask
_, oq = call("POST", "/questions", O, {"session_id": s2["id"], "body": "Question from a registered user"})
if "id" in oq:
    call("PATCH", f"/questions/{oq['id']}/approve", H)
    call("PATCH", f"/questions/{oq['id']}/reply", H, {"reply": "Replying to generate a notification."})
    time.sleep(1)  # the reply notification is fire-and-forget
else:
    print(f"  (could not seed a notification: {str(oq)[:90]})")

# Push subscription routes. The endpoint is fake but well-formed: the point is
# that the handler and its SQL run, not that a real device is reached.
hit("push VAPID key", "GET", "/notifications/push/key", H)
FAKE_ENDPOINT = f"https://fcm.googleapis.com/fcm/send/smoke-{stamp}"
hit("push subscribe", "POST", "/notifications/push", H,
    {"endpoint": FAKE_ENDPOINT, "keys": {"p256dh": "BEl62iUYgUivxIkv69yViEuiBIa1McQwFnuAqTNGVUmIOJnRFSTMHkPxWCPPXOB9F7BqTUUZDFOJVGxqTOaFTxk", "auth": "tBHItJI5svbpez7KI4CCXg=="}})
hit("push subscribe again (idempotent)", "POST", "/notifications/push", H,
    {"endpoint": FAKE_ENDPOINT, "keys": {"p256dh": "BEl62iUYgUivxIkv69yViEuiBIa1McQwFnuAqTNGVUmIOJnRFSTMHkPxWCPPXOB9F7BqTUUZDFOJVGxqTOaFTxk", "auth": "tBHItJI5svbpez7KI4CCXg=="}})
hit("push unsubscribe", "DELETE", "/notifications/push", H, {"endpoint": FAKE_ENDPOINT})

hit("list notifications", "GET", "/notifications", O)
hit("mark all read", "PATCH", "/notifications/read", O)
nid = sql(f"SELECT id FROM notifications WHERE user_id='{other_id}' LIMIT 1")
if nid:
    hit("mark one read", "PATCH", f"/notifications/{nid}/read", O)
    hit("delete notification", "DELETE", f"/notifications/{nid}", O)
else:
    print("  (no notification rows to exercise :id routes)")

# ── discover ─────────────────────────────────────────────────────────────────
print("\n=== discover ===")
hit("discover (no coords)", "GET", "/discover", H)
hit("discover (coords)", "GET", "/discover?lat=30.27&lng=-97.74&radius_km=50", H)
hit("discover (city)", "GET", "/discover?city=Austin", H)

# ── upload ───────────────────────────────────────────────────────────────────
print("\n=== upload ===")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
b = "----smoke" + stamp
mp = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\n"
      f"Content-Type: image/png\r\n\r\n").encode() + PNG + f"\r\n--{b}--\r\n".encode()
req = urllib.request.Request(API + "/upload", data=mp, method="POST")
req.add_header("Content-Type", f"multipart/form-data; boundary={b}")
req.add_header("Authorization", "Bearer " + H)
try:
    with urllib.request.urlopen(req, timeout=20) as r:
        print(f"  upload: {r.status}")
        calls.append("upload")
except urllib.error.HTTPError as e:
    calls.append("upload")
    if e.code >= 500:
        failures.append(("upload", "POST", "/upload", e.code, e.read()[:120].decode(errors="replace")))
        print(f"  [5xx] upload: {e.code}")

# ── admin ────────────────────────────────────────────────────────────────────
print("\n=== admin ===")
hit("admin me", "GET", "/admin/me", H)
hit("admin flags", "GET", "/admin/flags", H)
hit("admin sessions", "GET", "/admin/sessions", H)
hit("admin sessions search", "GET", "/admin/sessions?q=Smoke", H)
hit("feature session", "PATCH", f"/admin/sessions/{sid}/feature", H, {"featured": True})
hit("reveal identity", "GET", f"/admin/questions/{qid}/identity", H)
hit("banned words list", "GET", "/admin/banned-words", H)
code, bw = hit("add banned word", "POST", "/admin/banned-words", H, {"word": f"smokeword{stamp[-4:]}"})
bwid = bw.get("id")
if bwid:
    hit("remove banned word", "DELETE", f"/admin/banned-words/{bwid}", H)
hit("bans list", "GET", "/admin/bans", H)
hit("bans list (incl expired)", "GET", "/admin/bans?includeExpired=true", H)
code, ban = hit("create ban", "POST", "/admin/bans", H,
                {"guest_token": f"guest_smoke_{stamp}", "reason": "smoke", "duration_hours": 24})
if ban.get("id"):
    hit("lift ban", "DELETE", f"/admin/bans/{ban['id']}", H)

# ── export + close/reopen/delete last ────────────────────────────────────────
print("\n=== export + lifecycle ===")
hit("export CSV", "GET", f"/sessions/{sid}/export", H)
hit("close session", "POST", f"/sessions/{sid}/close", H)
hit("reopen session", "POST", f"/sessions/{sid}/reopen", H)
hit("delete session", "DELETE", f"/sessions/{sid}", H)
if org_id:
    hit("delete org", "DELETE", f"/orgs/{org_id}", H)

print(f"\n=== RESULT: {len(calls)} endpoints called, {len(failures)} returned 5xx ===")
for f in failures:
    print(f"  FAIL {f[1]} {f[2]} -> {f[3]}  {f[4]}")
print("ALL CLEAR" if not failures else "FAILURES PRESENT")
# Signal failure to the runner. Printing "FAILURES PRESENT" and exiting 0
# meant run.sh reported ALL SUITES PASSED with failing assertions in the
# output — the summary was only ever as honest as whoever read the lines
# above it.
raise SystemExit(0 if not failures else 1)
