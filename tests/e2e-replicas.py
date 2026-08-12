"""Two replicas, one Redis, one database.

The failure this guards against is silent: a client holding an SSE connection to
replica A never sees events produced on replica B, with no error anywhere. It
looks like nobody is asking questions.

So the test connects listeners to BOTH replicas, writes exclusively through one,
and asserts both listeners saw it. Run against replica A alone with Redis
disabled and the cross-replica assertions fail — which is the bug, reproduced.
"""
import json, re, subprocess, threading, time, urllib.error, urllib.request

A = "http://localhost:3081/api"   # replica A
B = "http://localhost:3082/api"   # replica B
DB = "aa_replica"

results = []
def check(label, got, want):
    ok = got == want
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got {got!r}, want {want!r}")

def call(base, method, path, token=None, body=None):
    req = urllib.request.Request(base + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = None if method == "GET" else json.dumps(body or {}).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=20) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}

def sql(q):
    out = subprocess.run(["psql", DB, "-tAc", q], capture_output=True, text=True, check=True).stdout
    rows = [ln.strip() for ln in out.splitlines() if ln.strip()]
    return "\n".join(r for r in rows if not re.match(r"^(INSERT|UPDATE|DELETE|SELECT)\s+\d", r))


class Listener:
    """Collects SSE event names from one replica."""
    def __init__(self, base, sid, token, name):
        self.events, self.name = [], name
        url = f"{base}/sessions/{sid}/stream?token={token}"
        self.thread = threading.Thread(target=self._run, args=(url,), daemon=True)
        self.thread.start()

    def _run(self, url):
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                for line in r:
                    s = line.decode(errors="replace").strip()
                    if s.startswith("event:"):
                        self.events.append(s.split(":", 1)[1].strip())
        except Exception:
            pass


stamp = str(int(time.time()))
print("=== setup ===")
_, host = call(A, "POST", "/auth/register", body={
    "email": f"rep{stamp}@t.com", "username": f"rep{stamp}", "password": "password123"})
H = host["token"]
_, sess = call(A, "POST", "/sessions", H, {"title": f"Replica {stamp}", "visibility": "public"})
sid = sess["id"]
call(A, "POST", f"/sessions/{sid}/go-live", H)

# Two guests: one connects to replica A, the other to replica B.
guests = []
for i, base in enumerate([A, B]):
    _, g = call(base, "POST", "/auth/guest")
    call(base, "POST", f"/sessions/{sid}/join", g["token"], {"guest_username": f"rep{i}{stamp[-4:]}"})
    guests.append(g)
_, asker = call(A, "POST", "/auth/guest")
call(A, "POST", f"/sessions/{sid}/join", asker["token"], {"guest_username": f"ask{stamp[-4:]}"})
print(f"  session {sess['slug']}, listeners on both replicas")

on_a = Listener(A, sid, guests[0]["token"], "A")
on_b = Listener(B, sid, guests[1]["token"], "B")
host_on_b = Listener(B, sid, H, "host-on-B")
time.sleep(3)

# ── 1. A write on A must reach a listener on B ───────────────────────────────
print("\n=== 1. write on replica A -> listener on replica B ===")
code, q = call(A, "POST", "/questions", asker["token"], {"session_id": sid, "body": "Posted on replica A"})
check("question accepted on A", code, 201)
time.sleep(3)
check("listener on A saw question:new", "question:new" in on_a.events, True)
check("listener on B saw question:new", "question:new" in on_b.events, True)

# ── 2. A write on B must reach a listener on A ───────────────────────────────
print("\n=== 2. write on replica B -> listener on replica A ===")
before_a = len(on_a.events)
code, _ = call(B, "POST", f"/questions/{q['id']}/echo", guests[1]["token"])
check("echo accepted on B", code, 200)
time.sleep(3)
check("listener on A saw echo:added", "echo:added" in on_a.events, True)
check("listener on A received something new", len(on_a.events) > before_a, True)

# ── 3. Role-targeted delivery must hold across replicas ──────────────────────
print("\n=== 3. role targeting survives the bus ===")
call(A, "PATCH", f"/questions/{q['id']}/status", H, {"status": "hidden"})
time.sleep(3)
# The host is connected to B while the moderation action happened on A.
check("host on B got the full question:updated", "question:updated" in host_on_b.events, True)
# Audience on either replica must get the bare removal, never the body.
check("audience on A got question:removed", "question:removed" in on_a.events, True)
check("audience on A did NOT get question:updated", "question:updated" in on_a.events, False)
check("audience on B got question:removed", "question:removed" in on_b.events, True)
check("audience on B did NOT get question:updated", "question:updated" in on_b.events, False)

# ── 4. No duplicate delivery ─────────────────────────────────────────────────
print("\n=== 4. events are delivered exactly once ===")
# The publishing replica must not also write locally; Redis echoes the publish
# back to it, so doing both would double every event for that replica's clients.
check("listener on A saw question:new exactly once", on_a.events.count("question:new"), 1)
check("listener on B saw question:new exactly once", on_b.events.count("question:new"), 1)
check("listener on A saw echo:added exactly once", on_a.events.count("echo:added"), 1)

# ── 5. Direct targeting (mute) reaches only its target ───────────────────────
print("\n=== 5. direct targeting across replicas ===")
pid = sql(f"SELECT id FROM session_participants WHERE session_id='{sid}' "
          f"AND guest_username='rep1{stamp[-4:]}'")
call(A, "PATCH", f"/sessions/{sid}/participants/{pid}/mute", H, {"mute": True})
time.sleep(3)
check("muted guest (on B) was notified", "participant:muted" in on_b.events, True)
check("other guest (on A) was not", "participant:muted" in on_a.events, False)

print(f"\nRESULT: {sum(results)}/{len(results)} passed",
      "— ALL PASS" if all(results) else "— FAILURES PRESENT")
raise SystemExit(0 if all(results) else 1)
