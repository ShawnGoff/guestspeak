"""Checks for the scale work: feed_mode switching, the feed cache and its
invalidation, moderator credit exemption, and the guest regen ceiling.

Uses LIVE_FEED_MAX_PARTICIPANTS=2 so the polling threshold can be crossed with
three guests instead of four hundred.
"""
import json, subprocess, time, urllib.request, urllib.error

API = "http://localhost:3098/api"
DB = "aa_e2e3"

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

def section(t): print(f"\n=== {t} ===")

stamp = str(int(time.time()))
_, h = call("POST", "/auth/register", body={
    "email": f"sh{stamp}@t.com", "username": f"sh{stamp}", "password": "password123"})
host = h["token"]

def guest(sid, name):
    _, g = call("POST", "/auth/guest")
    call("POST", f"/sessions/{sid}/join", g["token"], {"guest_username": name})
    return g["token"]

# ── 1. feed_mode threshold ───────────────────────────────────────────────────
section("1. FEED MODE — flips to polling past the threshold (set to 2)")
_, s = call("POST", "/sessions", host,
            {"title": "Scale", "visibility": "public", "credits_per_user": 6})
sid, slug = s["id"], s["slug"]
call("POST", f"/sessions/{sid}/go-live", host)

g1 = guest(sid, "g_one")
_, sess = call("GET", f"/sessions/{slug}")
check("small session is live", sess.get("feed_mode"), "live")
check("poll interval advertised", isinstance(sess.get("poll_interval_ms"), int), True)

g2 = guest(sid, "g_two")
g3 = guest(sid, "g_three")
_, sess = call("GET", f"/sessions/{slug}")
check("past threshold -> polling", sess.get("feed_mode"), "polling")

# host keeps the live stream regardless of size
_, hsess = call("GET", f"/sessions/{slug}", host)
check("host keeps live feed", hsess.get("feed_mode"), "live")

# SSE must refuse audience connections past the cap and say why
req = urllib.request.Request(f"{API}/sessions/{sid}/stream?token={g1}")
try:
    urllib.request.urlopen(req, timeout=8).close()
    code, payload = 200, {}
except urllib.error.HTTPError as e:
    code, payload = e.code, json.loads(e.read() or b"{}")
check("SSE refuses audience past cap", code, 409)
check("SSE tells client to poll", payload.get("feed_mode"), "polling")

# ── 2. Feed cache + invalidation ─────────────────────────────────────────────
section("2. FEED CACHE — serves repeats, invalidates on moderation")
_, q = call("POST", "/questions", g1, {"session_id": sid, "body": "Cached question one"})
time.sleep(2.5)  # let the 2s TTL lapse so the first read is fresh

_, r1 = call("GET", f"/questions?sessionId={sid}")
_, r2 = call("GET", f"/questions?sessionId={sid}")
check("repeat read is consistent", r1["data"][0]["id"], r2["data"][0]["id"])
check("question visible to audience", len(r1["data"]), 1)

# hide it — the cache must drop immediately, not after the TTL
call("PATCH", f"/questions/{q['id']}/status", host, {"status": "hidden"})
_, r3 = call("GET", f"/questions?sessionId={sid}")
check("hidden question gone immediately (cache invalidated)", len(r3["data"]), 0)

# moderator view is never cached and still sees it
_, rh = call("GET", f"/questions?sessionId={sid}", host)
check("host still sees hidden question", len(rh["data"]), 1)

# ── 3. Moderator credit exemption ────────────────────────────────────────────
section("3. MOD CREDITS — session staff are not charged")
_, mod = call("POST", "/auth/register", body={
    "email": f"mod{stamp}@t.com", "username": f"mod{stamp}", "password": "password123"})
mod_id = sql(f"SELECT id FROM users WHERE username='mod{stamp}'")
call("POST", f"/sessions/{sid}/moderators", host,
     {"user_id": mod_id, "can_mark_answered": True, "can_star": True, "can_hide": True})
call("POST", f"/sessions/{sid}/join", mod["token"], {})

before = sql(f"SELECT credits_remaining FROM session_participants "
             f"WHERE session_id='{sid}' AND user_id='{mod_id}'")
# more posts than the credit budget, and faster than the burst limit allows
codes = []
for i in range(8):
    c, _ = call("POST", "/questions", mod["token"],
                {"session_id": sid, "body": f"Moderator question number {i}"})
    codes.append(c)
after = sql(f"SELECT credits_remaining FROM session_participants "
            f"WHERE session_id='{sid}' AND user_id='{mod_id}'")
check("all 8 mod posts accepted", codes, [201] * 8)
check("mod credits untouched", after, before)

# ── 4. Guest regen ceiling ───────────────────────────────────────────────────
section("4. GUEST REGEN — ceiling of 2, and never reduces a larger balance")
gt = guest(sid, "regen_guy")
# a guest sitting above the cap must not be pulled down to it
call("POST", f"/sessions/{sid}/heartbeat", gt)
check("balance above cap left alone",
      sql(f"SELECT credits_remaining FROM session_participants "
          f"WHERE session_id='{sid}' AND guest_username='regen_guy'"), "6")

# drop to zero, then let regen run twice
# Backdate joined_at as well as clearing last_credit_at. A null last_credit_at
# no longer means "due now" — the regen clock falls back to joined_at, so that
# a guest who spends everything and reloads cannot claim a credit instantly.
sql(f"UPDATE session_participants SET credits_remaining=0, last_credit_at=NULL, joined_at=NOW() - INTERVAL '11 minutes' "
    f"WHERE session_id='{sid}' AND guest_username='regen_guy'")
call("POST", f"/sessions/{sid}/heartbeat", gt)
sql(f"UPDATE session_participants SET last_credit_at=NULL, joined_at=NOW() - INTERVAL '11 minutes' "
    f"WHERE session_id='{sid}' AND guest_username='regen_guy'")
_, hb = call("POST", f"/sessions/{sid}/heartbeat", gt)
sql(f"UPDATE session_participants SET last_credit_at=NULL, joined_at=NOW() - INTERVAL '11 minutes' "
    f"WHERE session_id='{sid}' AND guest_username='regen_guy'")
_, hb3 = call("POST", f"/sessions/{sid}/heartbeat", gt)

check("regen stops at the ceiling of 2", hb3.get("credits_remaining"), 2)
check("regen reported exhausted", hb3.get("regen_exhausted"), True)

# ── 5. Regen clock baseline ──────────────────────────────────────────────────
# The regression this exists for: spend everything, reload, and get a credit
# back instantly. Every check above backdates the clock before asking, which
# grants under the old rule and the new one alike — so none of them would have
# caught it coming back. This one leaves joined_at where it is.
section("5. REGEN CLOCK — a fresh join cannot mint a credit by reloading")
gt_fresh = guest(sid, "fresh_guy")
sql(f"UPDATE session_participants SET credits_remaining=0 "
    f"WHERE session_id='{sid}' AND guest_username='fresh_guy'")
_, f1 = call("POST", f"/sessions/{sid}/heartbeat", gt_fresh)
_, f2 = call("POST", f"/sessions/{sid}/heartbeat", gt_fresh)
check("no credit on the first reload", f1.get("credits_remaining"), 0)
check("nor on the second", f2.get("credits_remaining"), 0)
check("regen budget untouched",
      sql(f"SELECT regen_count FROM session_participants "
          f"WHERE session_id='{sid}' AND guest_username='fresh_guy'"), "0")
check("countdown is a real wait, not zero", f1.get("next_credit_secs", 0) > 0, True)

# ── 6. Regen ceiling honours the host's setting ──────────────────────────────
# credits_per_user used to be an opening balance only: regen walked guests to 2
# and registered users to 6 no matter what the host asked for. A host who runs a
# tight room means it.
section("6. REGEN CEILING — clamped to the host's credits_per_user")
_, tight = call("POST", "/sessions", host,
                {"title": "Tight", "visibility": "public", "credits_per_user": 1})
tid = tight["id"]
call("POST", f"/sessions/{tid}/go-live", host)
eligible = ("last_credit_at=NULL, joined_at=NOW() - INTERVAL '11 minutes'")

gt_tight = guest(tid, "tight_guest")
sql(f"UPDATE session_participants SET credits_remaining=0, {eligible} "
    f"WHERE session_id='{tid}' AND guest_username='tight_guest'")
call("POST", f"/sessions/{tid}/heartbeat", gt_tight)
sql(f"UPDATE session_participants SET {eligible} "
    f"WHERE session_id='{tid}' AND guest_username='tight_guest'")
_, g_hb = call("POST", f"/sessions/{tid}/heartbeat", gt_tight)
check("guest regen stops at the host's 1", g_hb.get("credits_remaining"), 1)
check("guest told the clamped cap", g_hb.get("regen_cap"), 1)

_, tu = call("POST", "/auth/register", body={
    "email": f"tu{stamp}@t.com", "username": f"tu{stamp}", "password": "password123"})
call("POST", f"/sessions/{tid}/join", tu["token"])
tuid = tu["user"]["id"]
sql(f"UPDATE session_participants SET credits_remaining=0, {eligible} "
    f"WHERE session_id='{tid}' AND user_id='{tuid}'")
call("POST", f"/sessions/{tid}/heartbeat", tu["token"])
sql(f"UPDATE session_participants SET {eligible} "
    f"WHERE session_id='{tid}' AND user_id='{tuid}'")
_, u_hb = call("POST", f"/sessions/{tid}/heartbeat", tu["token"])
check("registered regen stops at the host's 1", u_hb.get("credits_remaining"), 1)
check("registered told the clamped cap", u_hb.get("regen_cap"), 1)

# ── 7. Regen pauses until the show is live ───────────────────────────────────
# A podcast may open a session weeks out. Regen used to run through that whole
# window, so a listener who joined early could spend, wait ten minutes, and
# spend again — roughly a thousand times before anyone said a word. The opening
# allocation is the bound now; the clock only starts at go-live.
section("7. PRE-SHOW — the allocation is the bound until go-live")
_, pre = call("POST", "/sessions", host,
              {"title": "Next week", "visibility": "public", "credits_per_user": 6})
pid = pre["id"]
check("session starts upcoming", sql(f"SELECT status FROM sessions WHERE id='{pid}'"), "upcoming")

gt_pre = guest(pid, "early_bird")
sql(f"UPDATE session_participants SET credits_remaining=0, last_credit_at=NULL, "
    f"joined_at=NOW() - INTERVAL '7 days' WHERE session_id='{pid}' AND guest_username='early_bird'")
_, p1 = call("POST", f"/sessions/{pid}/heartbeat", gt_pre)
check("a week of waiting mints nothing", p1.get("credits_remaining"), 0)
check("client told regen is paused", p1.get("regen_paused"), True)
check("and given no countdown to promise one", p1.get("next_credit_secs"), 600)

call("POST", f"/sessions/{pid}/go-live", host)
check("went_live_at stamped",
      sql(f"SELECT went_live_at IS NOT NULL FROM sessions WHERE id='{pid}'"), "t")
check("everyone topped up to the host's allocation",
      sql(f"SELECT credits_remaining FROM session_participants "
          f"WHERE session_id='{pid}' AND guest_username='early_bird'"), "6")

# The stale joined_at must not make the whole audience eligible at once the
# instant the show starts — go-live stamps last_credit_at for exactly this.
sql(f"UPDATE session_participants SET credits_remaining=0 "
    f"WHERE session_id='{pid}' AND guest_username='early_bird'")
_, p2 = call("POST", f"/sessions/{pid}/heartbeat", gt_pre)
check("no thundering herd at go-live", p2.get("credits_remaining"), 0)
check("regen running again once live", p2.get("regen_paused"), False)

# ── 8. Rejection refund respects the ceiling ─────────────────────────────────
# A question waits in the approval queue for as long as a moderator takes, and
# regen keeps running while it waits. An author back at the cap by the time
# theirs is rejected was pushed past it — 7 credits in a 6-credit session.
section("8. REFUND — a rejected question's credit cannot exceed the ceiling")
_, ap = call("POST", "/sessions", host, {"title": "Approval", "visibility": "public",
                                         "credits_per_user": 6, "requires_approval": True})
aid = ap["id"]
call("POST", f"/sessions/{aid}/go-live", host)
stamp2 = stamp + "b"
_, au = call("POST", "/auth/register", body={
    "email": f"ru{stamp2}@t.com", "username": f"ru{stamp2}", "password": "password123"})
call("POST", f"/sessions/{aid}/join", au["token"])
auid = au["user"]["id"]
_, aq = call("POST", "/questions", au["token"],
             {"session_id": aid, "body": "A question awaiting moderator approval"})
check("question held for approval",
      sql(f"SELECT status FROM questions WHERE id='{aq['id']}'"), "pending")

# regen refills them back to the ceiling while it waits
sql(f"UPDATE session_participants SET last_credit_at=NOW() - INTERVAL '11 minutes' "
    f"WHERE session_id='{aid}' AND user_id='{auid}'")
call("POST", f"/sessions/{aid}/heartbeat", au["token"])
check("author back at the ceiling before the verdict",
      sql(f"SELECT credits_remaining FROM session_participants "
          f"WHERE session_id='{aid}' AND user_id='{auid}'"), "6")

call("PATCH", f"/questions/{aq['id']}/status", host, {"status": "hidden"})
check("refund does not push them past it",
      sql(f"SELECT credits_remaining FROM session_participants "
          f"WHERE session_id='{aid}' AND user_id='{auid}'"), "6")

print(f"\nRESULT: {sum(results)}/{len(results)} passed",
      "— ALL PASS" if all(results) else "— FAILURES PRESENT")
# Signal failure to the runner. Printing "FAILURES PRESENT" and exiting 0
# meant run.sh reported ALL SUITES PASSED with failing assertions in the
# output — the summary was only ever as honest as whoever read the lines
# above it.
raise SystemExit(0 if all(results) else 1)
