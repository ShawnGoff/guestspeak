import json, subprocess, time, urllib.request, urllib.error

API = "http://localhost:3099/api"

def call(method, path, token=None, body=None):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = json.dumps(body or {}).encode()
    try:
        with urllib.request.urlopen(req, data if method != "GET" else None) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw or b"{}")
        except Exception:
            return e.code, {"raw": raw[:120].decode(errors="replace")}

def credits_of(guest_username, sid):
    """Read the balance straight from the database.

    Going through an API call would perturb what we are measuring: /join
    re-upserts the participant and /heartbeat can award a regen credit.
    """
    out = subprocess.run(
        ["psql", "aa_e2e", "-tAc",
         f"SELECT credits_remaining FROM session_participants "
         f"WHERE session_id = '{sid}' AND guest_username = '{guest_username}'"],
        capture_output=True, text=True, check=True)
    return int(out.stdout.strip())

ok = True
def check(label, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  [{'PASS' if good else 'FAIL'}] {label}: got {got!r}, want {want!r}")

stamp = str(int(time.time()))

# ─── Test 1: echo on a closed session ────────────────────────────────────────
print("\n=== TEST 1: echoes must stop when the session closes ===")
_, h = call("POST", "/auth/register", body={
    "email": f"host{stamp}@t.com", "username": f"host{stamp}", "password": "password123"})
host = h["token"]

_, s = call("POST", "/sessions", host, {
    "title": "Echo Close Test", "visibility": "public", "credits_per_user": 6})
sid = s["id"]
call("POST", f"/sessions/{sid}/go-live", host)

_, ga = call("POST", "/auth/guest")
_, gb = call("POST", "/auth/guest")
call("POST", f"/sessions/{sid}/join", ga["token"], {"guest_username": "asker_a"})
call("POST", f"/sessions/{sid}/join", gb["token"], {"guest_username": "echoer_b"})

_, q1 = call("POST", "/questions", ga["token"], {"session_id": sid, "body": "First question here"})
time.sleep(11)  # clear the burst window
_, q2 = call("POST", "/questions", ga["token"], {"session_id": sid, "body": "Second question here"})

code, r = call("POST", f"/questions/{q1['id']}/echo", gb["token"])
check("echo while live", code, 200)
check("vote_count incremented", r.get("vote_count"), 1)

call("POST", f"/sessions/{sid}/close", host)

code, r = call("POST", f"/questions/{q2['id']}/echo", gb["token"])
check("echo after close is rejected", code, 410)
check("error message", r.get("error"), "Session is closed")

# ─── Test 2: rejected pending question refunds its credit ────────────────────
print("\n=== TEST 2: rejecting a pending question refunds the credit ===")
_, s2 = call("POST", "/sessions", host, {
    "title": "Approval Refund Test", "visibility": "public",
    "credits_per_user": 6, "requires_approval": True})
sid2 = s2["id"]
call("POST", f"/sessions/{sid2}/go-live", host)

_, gc = call("POST", "/auth/guest")
_, joined = call("POST", f"/sessions/{sid2}/join", gc["token"], {"guest_username": "asker_c"})
start_credits = joined["credits_remaining"]
check("starting credits", start_credits, 6)

_, pq = call("POST", "/questions", gc["token"], {"session_id": sid2, "body": "Pending question here"})
check("question starts pending", pq.get("status"), "pending")
after_ask = credits_of("asker_c", sid2)
check("credit spent on ask", after_ask, start_credits - 1)

# Host rejects it -> pending becomes hidden
code, _ = call("PATCH", f"/questions/{pq['id']}/status", host, {"status": "hidden"})
check("reject succeeds", code, 200)
after_reject = credits_of("asker_c", sid2)
check("credit refunded on reject", after_reject, start_credits)

# ─── Test 3: hiding an APPROVED question must NOT refund ─────────────────────
print("\n=== TEST 3: hiding a published question must not refund ===")
time.sleep(11)
_, pq2 = call("POST", "/questions", gc["token"], {"session_id": sid2, "body": "Another pending one"})
before = credits_of("asker_c", sid2)
call("PATCH", f"/questions/{pq2['id']}/approve", host)
call("PATCH", f"/questions/{pq2['id']}/status", host, {"status": "hidden"})
after = credits_of("asker_c", sid2)
check("no refund for approved-then-hidden", after, before)

print("\nRESULT:", "ALL PASS" if ok else "FAILURES PRESENT")
