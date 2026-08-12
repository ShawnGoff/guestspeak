"""Write-path load test.

Answers one question: how many questions and echoes per second can the backend
sustain before something breaks, and what breaks first.

The database here is local PostgreSQL, not Supabase Nano, so raw hardware speed
does not transfer. What does transfer is the *shape* of the constraint: the
backend runs with DB_POOL_MAX pinned to 15, which is exactly the number of real
Postgres connections Supavisor maintains on a Nano instance. That is the wall in
production, so it is the wall modelled here.

Echoes are the primary load vector because they are the realistic burst: a host
says "vote for the question you want answered" and half the room acts within
thirty seconds. They also avoid the per-participant burst limit that would
otherwise throttle synthetic question spam into meaninglessness.
"""
import json, os, re, statistics, subprocess, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "http://localhost:3095/api"
JWT_SECRET = "loadtest_secret"
FIRST_ERR = None
DB = "aa_load"

PARTICIPANTS = 240      # distinct guests generating load
QUESTIONS = 100         # targets to echo; participants x questions = unique pairs
LEVELS = [1, 5, 15, 30, 60, 120, 240]
SECONDS_PER_LEVEL = 8


def call(method, path, token=None, body=None, timeout=30):
    req = urllib.request.Request(API + path, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    data = None if method == "GET" else json.dumps(body or {}).encode()
    try:
        with urllib.request.urlopen(req, data, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        global FIRST_ERR
        if FIRST_ERR is None:
            FIRST_ERR = f"{type(e).__name__}: {e}"
        return 0, {"error": type(e).__name__}


def sql(q):
    """Run SQL and return only the result rows.

    psql prints a command status line ("INSERT 0 1") to stdout alongside the
    RETURNING output, which silently corrupts any value read straight from
    .stdout — an id with "\nINSERT 0 1" appended makes an invalid URL that
    fails before the request is ever sent.
    """
    out = subprocess.run(["psql", DB, "-tAc", q],
                         capture_output=True, text=True, check=True).stdout
    rows = [ln.strip() for ln in out.splitlines() if ln.strip()]
    return "\n".join(r for r in rows
                      if not re.match(r"^(INSERT|UPDATE|DELETE|SELECT|COPY)\s+\d", r))


# ─── Setup ───────────────────────────────────────────────────────────────────

def setup():
    stamp = str(int(time.time()))
    _, host = call("POST", "/auth/register", body={
        "email": f"load{stamp}@t.com", "username": f"load{stamp}", "password": "password123"})
    H = host["token"]

    _, sess = call("POST", "/sessions", H, {
        "title": f"Load {stamp}", "visibility": "public", "credits_per_user": 6})
    sid = sess["id"]
    call("POST", f"/sessions/{sid}/go-live", H)

    print(f"  session {sess['slug']}")

    # An author for the questions being echoed. Kept separate from the load
    # generators because a participant cannot echo their own question.
    _, author = call("POST", "/auth/guest")
    call("POST", f"/sessions/{sid}/join", author["token"], {"guest_username": "author"})
    sql(f"UPDATE session_participants SET credits_remaining = 100000 "
        f"WHERE session_id = '{sid}'")

    qids = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        def mk(i):
            # Burst limiting is per participant and would reject rapid authoring,
            # so questions are inserted directly. They only need to exist.
            qid = sql(
                f"INSERT INTO questions (session_id, author_guest_token, body, status, author_display_name) "
                f"VALUES ('{sid}', '{author['guestToken']}', 'Load target question number {i}', "
                f"'new', 'author') RETURNING id")
            return qid
        qids = list(ex.map(mk, range(QUESTIONS)))
    print(f"  {len(qids)} questions to echo")

    # Load generators.
    #
    # Created directly rather than through POST /auth/guest, because the guest
    # limiter caps token issuance at 120 per 15 minutes per IP — correct
    # behaviour that makes it impossible to *set up* a load test from one host.
    # The rows and tokens are identical to what that endpoint produces, so the
    # requests under measurement still exercise the real code path.
    rows = sql(f"""
      WITH new_users AS (
        INSERT INTO users (is_guest) SELECT true FROM generate_series(1, {PARTICIPANTS})
        RETURNING id
      ), numbered AS (
        SELECT id, row_number() OVER () AS n FROM new_users
      )
      INSERT INTO session_participants (session_id, guest_token, guest_username, credits_remaining)
      SELECT '{sid}', 'guest_load_' || n, 'load' || n, 100000 FROM numbered
      RETURNING guest_token
    """)
    guest_tokens = [t for t in rows.split("\n") if t.strip()]

    # Sign JWTs with the same secret and shape the server issues.
    payloads = json.dumps([{"userId": None, "isGuest": True, "guestToken": t} for t in guest_tokens])
    signer = """
      const jwt = require('jsonwebtoken');
      const items = JSON.parse(process.argv[1]);
      console.log(JSON.stringify(items.map(p =>
        jwt.sign({ isGuest: true, guestToken: p.guestToken }, process.env.JWT_SECRET, { expiresIn: '1h' })
      )));
    """
    out = subprocess.run(
        ["node", "-e", signer, payloads],
        capture_output=True, text=True, check=True,
        cwd="../backend", env={**os.environ, "JWT_SECRET": JWT_SECRET})
    tokens = json.loads(out.stdout)

    print(f"  {len(tokens)} participants ready")
    return sid, qids, tokens


# ─── Load ────────────────────────────────────────────────────────────────────

def run_level(concurrency, qids, tokens, seconds, reset=True):
    """Measure sustained echo throughput at a given concurrency.

    Every request must do real work. A vote is unique per (participant,
    question), so a repeated pair returns 409 from a constraint violation —
    cheap, and nothing like the write it is standing in for. An earlier run was
    90% 409s and the throughput number it produced was meaningless.

    Two things keep the work real: votes are cleared before each level, and each
    worker walks a disjoint slice of the pair space so no pair is used twice.
    """
    if reset:
        # Outside the timing window.
        sql("DELETE FROM votes")
        sql("UPDATE session_participants SET credits_remaining = 100000")

    stop = time.time() + seconds
    latencies, codes = [], {}
    lock = threading.Lock()

    def worker(w):
        local_lat, local_codes = [], {}
        n = 0
        while time.time() < stop:
            # Disjoint pair space: index advances by the worker count so two
            # workers never collide, and decomposes into a unique
            # (participant, question) pair until the space is exhausted.
            pair = w + n * concurrency
            token = tokens[pair % len(tokens)]
            qid = qids[(pair // len(tokens)) % len(qids)]
            t0 = time.perf_counter()
            code, _ = call("POST", f"/questions/{qid}/echo", token)
            local_lat.append((time.perf_counter() - t0) * 1000)
            local_codes[code] = local_codes.get(code, 0) + 1
            n += 1
        with lock:
            latencies.extend(local_lat)
            for k, v in local_codes.items():
                codes[k] = codes.get(k, 0) + v

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        list(ex.map(worker, range(concurrency)))
    elapsed = time.perf_counter() - t0

    ok = codes.get(200, 0)
    total = sum(codes.values())
    lat = sorted(latencies)
    pct = lambda p: lat[min(int(len(lat) * p), len(lat) - 1)] if lat else 0

    return {
        "concurrency": concurrency,
        "ops_per_sec": ok / elapsed,
        "p50": pct(0.50), "p95": pct(0.95), "p99": pct(0.99),
        "ok": ok, "total": total,
        "codes": codes,
    }


def main():
    print("=== setup ===")
    sid, qids, tokens = setup()

    print("\n=== warmup ===")
    run_level(10, qids, tokens, 3)

    print("\n=== ramp (echo write path, DB_POOL_MAX=15) ===")
    print(f"{'conc':>5} {'ops/sec':>9} {'p50':>8} {'p95':>8} {'p99':>8}  {'ok/total':>12}  notes")
    results = []
    for c in LEVELS:
        r = run_level(c, qids, tokens, SECONDS_PER_LEVEL)
        results.append(r)
        others = {k: v for k, v in r["codes"].items() if k != 200}
        note = "" if not others else " ".join(f"{k}:{v}" for k, v in sorted(others.items()))
        print(f"{r['concurrency']:>5} {r['ops_per_sec']:>9.0f} {r['p50']:>7.0f}ms {r['p95']:>7.0f}ms "
              f"{r['p99']:>7.0f}ms  {r['ok']:>5}/{r['total']:<6}  {note}")

    best = max(results, key=lambda r: r["ops_per_sec"])
    print(f"\npeak sustained: {best['ops_per_sec']:.0f} echoes/sec at concurrency {best['concurrency']}")

    # Read path, for contrast: the feed is cached, so crowd size should barely
    # register regardless of how many are polling.
    print("\n=== read path (cached feed) ===")
    stop = time.time() + 5
    rl, rc = [], 0
    def reader(_):
        nonlocal rc
        while time.time() < stop:
            t0 = time.perf_counter()
            code, _ = call("GET", f"/questions?sessionId={sid}")
            rl.append((time.perf_counter() - t0) * 1000)
            if code == 200: rc += 1
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=60) as ex:
        list(ex.map(reader, range(60)))
    el = time.perf_counter() - t0
    rl.sort()
    print(f"  60 concurrent readers: {rc/el:.0f} reads/sec, "
          f"p50 {rl[len(rl)//2]:.0f}ms, p95 {rl[int(len(rl)*0.95)]:.0f}ms")
    qcount = sql("SELECT count(*) FROM pg_stat_statements WHERE query LIKE '%FROM questions q%'") \
        if False else "n/a"
    print("\nDone.")


if __name__ == "__main__":
    main()
