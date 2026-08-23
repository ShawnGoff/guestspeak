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

# ── 8. Hiding a reply ────────────────────────────────────────────────────────
# Replies are free, so there is no credit economy slowing anyone down and
# moderation is the only brake. It ships with the feed rather than after it.
section("8. HIDING — staff can remove a reply, and it is recorded")
hid = mkuser("cfhid")
_, hr = call("POST", f"/prompts/{pid}/replies", hid["token"], {"body": "A reply to be removed"})
hrid = hr["id"]

check("a stranger cannot hide someone's reply",
      call("PATCH", f"/prompts/{pid}/replies/{hrid}/hide", stranger["token"])[0], 403)
check("the author cannot hide their way out of it",
      call("PATCH", f"/prompts/{pid}/replies/{hrid}/hide", hid["token"])[0], 403)

code, hidden = call("PATCH", f"/prompts/{pid}/replies/{hrid}/hide", host["token"])
check("the host can hide it", code, 200)
check("status is hidden", hidden.get("status"), "hidden")
check("and who hid it is recorded",
      sql(f"SELECT hidden_by IS NOT NULL AND hidden_at IS NOT NULL FROM channel_replies WHERE id='{hrid}'"), "t")

_, pub2 = call("GET", f"/prompts/{pid}/replies")
check("it leaves the public list",
      any(r["id"] == hrid for r in pub2.get("replies") or []), False)

call("PATCH", f"/prompts/{pid}/replies/{hrid}/hide", host["token"])
check("un-hiding clears the record",
      sql(f"SELECT hidden_by IS NULL AND hidden_at IS NULL FROM channel_replies WHERE id='{hrid}'"), "t")

# ── 9. Blocking someone from the feed ────────────────────────────────────────
# One reply per prompt bounds a single thread; this is for the person who comes
# back to the next one.
section("9. BLOCKING — scoped to this channel, not the platform")
pest = mkuser("cfpest")
_, p2 = call("POST", f"/orgs/{org_id}/prompts", host["token"], {"body": "Second prompt for blocking"})
p2id = p2["id"]
check("they can reply before being blocked",
      call("POST", f"/prompts/{p2id}/replies", pest["token"], {"body": "First reply"})[0], 201)

check("a stranger cannot block for someone else's channel",
      call("POST", f"/orgs/{org_id}/feed-blocks", stranger["token"],
           {"user_id": pest["user"]["id"]})[0], 403)
check("staff cannot be blocked out of their own channel",
      call("POST", f"/orgs/{org_id}/feed-blocks", host["token"],
           {"user_id": host["user"]["id"]})[0], 403)

check("the host can block them",
      call("POST", f"/orgs/{org_id}/feed-blocks", host["token"],
           {"user_id": pest["user"]["id"], "reason": "abuse"})[0], 201)

_, p3 = call("POST", f"/orgs/{org_id}/prompts", host["token"], {"body": "Third prompt after the block"})
check("a blocked account cannot reply to a new prompt",
      call("POST", f"/prompts/{p3['id']}/replies", pest["token"], {"body": "Back again"})[0], 403)
check("but everyone else still can",
      call("POST", f"/prompts/{p3['id']}/replies", fan["token"], {"body": "Normal reply"})[0], 201)

_, blocks = call("GET", f"/orgs/{org_id}/feed-blocks", host["token"])
check("the block is listed for staff", len(blocks.get("blocks") or []), 1)
check("blocking twice is not an error",
      call("POST", f"/orgs/{org_id}/feed-blocks", host["token"],
           {"user_id": pest["user"]["id"]})[0], 201)

call("DELETE", f"/orgs/{org_id}/feed-blocks/{pest['user']['id']}", host["token"])
check("unblocking lets them back in",
      call("POST", f"/prompts/{p3['id']}/replies", pest["token"], {"body": "Behaving now"})[0], 201)

# ── 10. Telling followers ────────────────────────────────────────────────────
# A host can post a prompt, but if nobody hears about it the feed only exists
# for people who happen to visit the channel page.
section("10. NOTIFYING — followers hear about a new prompt, once")
nh = mkuser("cfnh")
_, norg = call("POST", "/orgs", nh["token"],
               {"name": f"Notify channel {stamp}", "slug": f"cfnot{stamp}"})
norg_id = norg["id"]

follower    = mkuser("cffol")
nonfollower = mkuser("cfnon")
call("POST", f"/orgs/{norg_id}/follow", follower["token"])

call("POST", f"/orgs/{norg_id}/prompts", nh["token"], {"body": "First question for you all"})
time.sleep(1)   # the fan-out runs after the response

def notes(user_id):
    return sql(f"SELECT count(*) FROM notifications WHERE user_id='{user_id}' "
               f"AND type='channel:prompt'")

check("a follower is notified", notes(follower["user"]["id"]), "1")
check("someone who does not follow is not", notes(nonfollower["user"]["id"]), "0")
check("the payload carries the channel",
      sql(f"SELECT payload->>'org_id' FROM notifications WHERE type='channel:prompt' "
          f"AND user_id='{follower['user']['id']}'"), norg_id)

# The cooldown: posting again straight away must not blast them a second time.
call("POST", f"/orgs/{norg_id}/prompts", nh["token"], {"body": "Second question, right away"})
time.sleep(1)
check("a second prompt within the cooldown does not notify again",
      notes(follower["user"]["id"]), "1")
check("but the prompt itself still posted",
      sql(f"SELECT count(*) FROM channel_prompts WHERE org_id='{norg_id}'"), "2")

# Backdate the notification past the window and the next one gets through.
sql(f"UPDATE notifications SET created_at = NOW() - INTERVAL '7 hours' "
    f"WHERE type='channel:prompt' AND payload->>'org_id'='{norg_id}'")
call("POST", f"/orgs/{norg_id}/prompts", nh["token"], {"body": "Third question, next day"})
time.sleep(1)
check("once the cooldown has passed, followers hear again",
      notes(follower["user"]["id"]), "2")

# ── 11. Fixing your own reply ────────────────────────────────────────────────
# One reply per prompt made a typo permanent: you could not fix it and could not
# try again. Five minutes, not the sixty seconds a question gets — nothing
# accumulates on a channel reply, so the pressure that justifies a short window
# on a live question is absent.
section("11. EDIT WINDOW — the author can fix their own words for five minutes")
# Reusing accounts rather than making more: registerLimiter allows 10 per 15
# minutes per IP and this suite is already at it. None of these have replied to
# the new prompt, which is all that matters.
eh = fan
_, ep = call("POST", f"/orgs/{org_id}/prompts", host["token"], {"body": "A prompt for edit testing"})
epid = ep["id"]
_, er = call("POST", f"/prompts/{epid}/replies", eh["token"], {"body": "Teh reply wiht typos"})
erid = er["id"]

code, edited = call("PATCH", f"/prompts/{epid}/replies/{erid}", eh["token"],
                    {"body": "The reply with typos fixed"})
check("the author can fix their reply", code, 200)
check("the new text is stored", edited.get("body"), "The reply with typos fixed")
check("and it is marked as edited",
      sql(f"SELECT edited_at IS NOT NULL FROM channel_replies WHERE id='{erid}'"), "t")

check("a stranger cannot edit it",
      call("PATCH", f"/prompts/{epid}/replies/{erid}", stranger["token"], {"body": "Rewritten"})[0], 403)
check("nor can the host",
      call("PATCH", f"/prompts/{epid}/replies/{erid}", host["token"], {"body": "Host rewrite"})[0], 403)
check("the text survived both attempts",
      sql(f"SELECT body FROM channel_replies WHERE id='{erid}'"), "The reply with typos fixed")

# The hide route must still resolve — /:replyId is registered before
# /:replyId/hide, and a greedy match would have swallowed it.
check("hiding still routes correctly",
      call("PATCH", f"/prompts/{epid}/replies/{erid}/hide", host["token"])[0], 200)
check("a hidden reply cannot be rewritten",
      call("PATCH", f"/prompts/{epid}/replies/{erid}", eh["token"], {"body": "Sneaking a change in"})[0], 409)
call("PATCH", f"/prompts/{epid}/replies/{erid}/hide", host["token"])

# Past the deadline
sql(f"UPDATE channel_replies SET created_at = NOW() - INTERVAL '6 minutes' WHERE id='{erid}'")
check("the window closes after five minutes",
      call("PATCH", f"/prompts/{epid}/replies/{erid}", eh["token"], {"body": "Too late now"})[0], 409)

# The filter reaches the edit path too — this was a real bug on questions.
if banned:
    wf2 = hid
    _, wr = call("POST", f"/prompts/{epid}/replies", wf2["token"], {"body": "A clean reply first"})
    call("PATCH", f"/prompts/{epid}/replies/{wr['id']}", wf2["token"],
         {"body": f"Now with {banned} in it"})
    check("the edit window is not a filter bypass",
          banned in sql(f"SELECT body FROM channel_replies WHERE id='{wr['id']}'"), False)

# ── 12. Review findings ──────────────────────────────────────────────────────
section("12. REVIEW — closing freezes the thread, deletion scrubs the byline")

# Closing is not just "no new replies": a host who closes a prompt is done with
# it, and answers shifting underneath them afterwards is what closing prevents.
_, cp = call("POST", f"/orgs/{org_id}/prompts", host["token"], {"body": "Prompt to be closed mid-window"})
cpid = cp["id"]
_, cr = call("POST", f"/prompts/{cpid}/replies", late["token"], {"body": "Wording before the close"})
check("editable while open",
      call("PATCH", f"/prompts/{cpid}/replies/{cr['id']}", late["token"],
           {"body": "Edited while still open"})[0], 200)
call("PATCH", f"/prompts/{cpid}/close", host["token"])
check("closing freezes it, even inside the window",
      call("PATCH", f"/prompts/{cpid}/replies/{cr['id']}", late["token"],
           {"body": "Edited after the close"})[0], 410)
check("the wording the host closed on is what stands",
      sql(f"SELECT body FROM channel_replies WHERE id='{cr['id']}'"), "Edited while still open")

# A deleted account must not keep its name on replies it left. questions.
# author_display_name is scrubbed on deletion for exactly this reason; the same
# snapshot on channel_replies was not.
_, dp = call("POST", f"/orgs/{org_id}/prompts", host["token"], {"body": "Prompt for the deletion check"})
gone_name = pest["user"]["username"]
call("POST", f"/prompts/{dp['id']}/replies", pest["token"], {"body": "Something I later regret"})
call("DELETE", "/auth/me", pest["token"], {"password": "password123"})
_, after = call("GET", f"/prompts/{dp['id']}/replies")
bylines = [r["author_username"] for r in after.get("replies") or []]
check("a deleted account's name is gone from its replies", gone_name in bylines, False)
check("and the reply itself survives, unattributed", "Removed account" in bylines, True)

# ── 12. Closing freezes the thread ───────────────────────────────────────────
# The edit window exists so an author can fix a typo. It should not let answers
# shift underneath a host who has closed the prompt and is done reading it.
section("12. CLOSED — a closed prompt freezes its replies")
_, fp = call("POST", f"/orgs/{org_id}/prompts", host["token"], {"body": "A prompt to be frozen"})
fpid = fp["id"]
_, fr = call("POST", f"/prompts/{fpid}/replies", fan["token"], {"body": "An answer before closing"})
frid = fr["id"]
check("editable while the prompt is open",
      call("PATCH", f"/prompts/{fpid}/replies/{frid}", fan["token"],
           {"body": "An answer, tidied up"})[0], 200)
call("PATCH", f"/prompts/{fpid}/close", host["token"])
check("frozen once the host closes it",
      call("PATCH", f"/prompts/{fpid}/replies/{frid}", fan["token"],
           {"body": "Sneaking a change in after close"})[0], 410)
check("and the text is untouched",
      sql(f"SELECT body FROM channel_replies WHERE id='{frid}'"), "An answer, tidied up")

# ── 13. Paging and sort ──────────────────────────────────────────────────────
# A popular prompt used to truncate silently at 200 with no way to see the rest.
section("13. PAGING — a long thread pages, and can be read newest first")
_, pp = call("POST", f"/orgs/{org_id}/prompts", host["token"], {"body": "A prompt with many replies"})
ppid = pp["id"]
# Seeded directly: one reply per account is the rule, and the point here is the
# read path, not the write path.
for i in range(12):
    sql(f"INSERT INTO channel_replies (prompt_id, author_display_name, body, created_at) "
        f"VALUES ('{ppid}', 'Person{i:02d}', 'Reply number {i:02d}', NOW() + INTERVAL '{i} seconds')")

_, page1 = call("GET", f"/prompts/{ppid}/replies?limit=5")
check("a page is the size asked for", len(page1.get("replies") or []), 5)
check("the total is the whole thread", page1.get("total"), 12)
check("and it says there is more", page1.get("has_more"), True)
check("oldest first by default", page1["replies"][0]["body"], "Reply number 00")

_, page3 = call("GET", f"/prompts/{ppid}/replies?limit=5&offset=10")
check("the last page returns the remainder", len(page3.get("replies") or []), 2)
check("and says there is no more", page3.get("has_more"), False)

_, newest = call("GET", f"/prompts/{ppid}/replies?sort=newest&limit=5")
check("newest first when asked", newest["replies"][0]["body"], "Reply number 11")

_, clamped = call("GET", f"/prompts/{ppid}/replies?limit=99999")
check("an absurd limit is clamped, not honoured", clamped.get("limit"), 100)

print(f"\nRESULT: {sum(results)}/{len(results)} passed",
      "— ALL PASS" if all(results) else "— FAILURES PRESENT")
raise SystemExit(0 if all(results) else 1)
