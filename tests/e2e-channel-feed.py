"""Channel feeds: a host asks their audience something between shows.

Covers who may post a prompt, who may reply, the one-reply rule, closing a
prompt, and the controls that matter more here than elsewhere because replies
are free — the account requirement and the word filter.
"""
import json, subprocess, time, urllib.request, urllib.error

API = "http://localhost:3093/api"
DB = "aa_feed"

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
def mkuser(prefix):
    _, u = call("POST", "/auth/register", body={
        "email": f"{prefix}{stamp}@t.com", "username": f"{prefix}{stamp}",
        "password": "password123"})
    return u

host      = mkuser("cfhost")
fan       = mkuser("cffan")
stranger  = mkuser("cfstr")

_, org = call("POST", "/orgs", host["token"],
              {"name": f"Feed channel {stamp}", "slug": f"cfchan{stamp}"})
org_id = org["id"]

# ── 1. Only the people running the channel can open a thread ─────────────────
section("1. PROMPTS — the host opens every thread")
code, prompt = call("POST", f"/orgs/{org_id}/prompts", host["token"],
                    {"body": "Who would you like to see as a guest?"})
check("channel owner can post a prompt", code, 201)
pid = prompt.get("id")

check("a stranger cannot post to someone else's channel",
      call("POST", f"/orgs/{org_id}/prompts", stranger["token"], {"body": "Hijacking this"})[0], 403)
_, g = call("POST", "/auth/guest")
check("a guest cannot post a prompt",
      call("POST", f"/orgs/{org_id}/prompts", g["token"], {"body": "Guest prompt"})[0], 403)
check("anonymous cannot post a prompt",
      call("POST", f"/orgs/{org_id}/prompts", None, {"body": "Anon prompt"})[0], 401)

code, listing = call("GET", f"/orgs/{org_id}/prompts")
check("the feed is public to read", code, 200)
check("the prompt is listed", len(listing.get("prompts") or []), 1)

# ── 2. Replies: an account, not a follow ─────────────────────────────────────
section("2. REPLIES — a registered account is the bar, not a follow")
code, reply = call("POST", f"/prompts/{pid}/replies", fan["token"],
                   {"body": "Please get the drummer from that band on"})
check("a registered account can reply without following", code, 201)
check("the reply carries a byline", bool(reply.get("author_display_name")), True)

check("a guest cannot reply",
      call("POST", f"/prompts/{pid}/replies", g["token"], {"body": "Guest reply"})[0], 403)
check("anonymous cannot reply",
      call("POST", f"/prompts/{pid}/replies", None, {"body": "Anon reply"})[0], 401)

# ── 3. One reply each ────────────────────────────────────────────────────────
section("3. ONE REPLY — enforced by the index, not a prior SELECT")
check("a second reply from the same person is refused",
      call("POST", f"/prompts/{pid}/replies", fan["token"], {"body": "Actually, someone else"})[0], 409)
check("still exactly one reply stored",
      sql(f"SELECT count(*) FROM channel_replies WHERE prompt_id='{pid}'"), "1")
check("but somebody else may still reply",
      call("POST", f"/prompts/{pid}/replies", stranger["token"], {"body": "Seconded, the drummer"})[0], 201)

# ── 4. Replies are free ──────────────────────────────────────────────────────
section("4. FREE — no credit is spent, because there is no session")
check("no participant row was created for the replier",
      sql(f"SELECT count(*) FROM session_participants WHERE user_id='{fan['user']['id']}'"), "0")

# ── 5. The word filter reaches here too ──────────────────────────────────────
section("5. WORD FILTER — free replies are not an unfiltered channel")
banned = sql("SELECT word FROM banned_words LIMIT 1")
if banned:
    wf = mkuser("cfwf")
    call("POST", f"/prompts/{pid}/replies", wf["token"], {"body": f"Get {banned} on the show"})
    stored = sql(f"SELECT body FROM channel_replies WHERE prompt_id='{pid}' "
                 f"AND author_id='{wf['user']['id']}'")
    check("a banned word is masked in a reply", banned in stored, False)

# ── 6. Closing a prompt ──────────────────────────────────────────────────────
section("6. CLOSING — the host decides when it stops taking replies")
check("a stranger cannot close it",
      call("PATCH", f"/prompts/{pid}/close", stranger["token"])[0], 403)
code, closed = call("PATCH", f"/prompts/{pid}/close", host["token"])
check("the host can close it", code, 200)
check("and it is marked closed", bool(closed.get("closed_at")), True)

late = mkuser("cflate")
check("a closed prompt refuses new replies",
      call("POST", f"/prompts/{pid}/replies", late["token"], {"body": "Am I too late?"})[0], 410)

call("PATCH", f"/prompts/{pid}/close", host["token"])
check("reopening lets replies through again",
      call("POST", f"/prompts/{pid}/replies", late["token"], {"body": "Trying again"})[0], 201)

# ── 7. Hidden replies ────────────────────────────────────────────────────────
section("7. HIDDEN — removed replies stay out of the public list")
rid = sql(f"SELECT id FROM channel_replies WHERE prompt_id='{pid}' "
          f"AND author_id='{stranger['user']['id']}'")
sql(f"UPDATE channel_replies SET status='hidden' WHERE id='{rid}'")
_, pub = call("GET", f"/prompts/{pid}/replies")
check("the audience does not see a hidden reply",
      any(r["id"] == rid for r in pub.get("replies") or []), False)
_, staff = call("GET", f"/prompts/{pid}/replies", host["token"])
check("the host still sees it",
      any(r["id"] == rid for r in staff.get("replies") or []), True)

print(f"\nRESULT: {sum(results)}/{len(results)} passed",
      "— ALL PASS" if all(results) else "— FAILURES PRESENT")
raise SystemExit(0 if all(results) else 1)
