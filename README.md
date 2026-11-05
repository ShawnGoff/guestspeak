# GuestSpeak

Live audience Q&A for broadcasts, events and shows. The room asks the questions,
the room decides which ones matter, and the host answers the top of the list.

A listener joins with a code read out on air — no app, no account, no email
address. They get a handful of credits per session, so asking is scarce enough
to be worth doing well, and agreeing with someone else's question costs one tap
instead of another phone call. The host sees the questions ranked by the room
rather than by who typed fastest, and nothing reaches the room that a producer
has not let through.

**[guestspeak.app](https://guestspeak.app)** · [try the demo](https://guestspeak.app/demo)
— mock data, both sides of a live session, nothing to sign up for.

## Licence

**Source-available, not open source.** This is published under the
[PolyForm Noncommercial License 1.0.0](LICENSE): read it, learn from it, run it,
modify it, use it for anything noncommercial. You may not use it, or anything
derived from it, for commercial purposes.

If you want to use this commercially, ask.

## How it is put together

| | |
| --- | --- |
| `frontend/` | Next.js 14 App Router, Tailwind, deployed on Vercel |
| `backend/` | Express + TypeScript, deployed on Railway |
| `shared/` | Types used by both, so the API contract is checked at compile time |
| `database/` | 46 numbered SQL migrations, applied in order and tracked in `schema_migrations` |
| `tests/` | End-to-end suites that run the real backend against a throwaway database |
| `docs/` | Runbooks for the parts that are easy to get wrong |

Live updates go over Server-Sent Events, with a Redis bus so a session works
across more than one backend instance. Sessions above a participant threshold
fall back to polling rather than holding a connection per person.

## Running it

You need Node, and a local PostgreSQL the current user can create databases on.

```bash
npm install
createdb askaway
cd backend && cp .env.example .env     # then fill in DATABASE_URL and JWT_SECRET
npm run migrate
```

Then from the repo root:

```bash
npm run dev
```

Frontend on `:3000`, backend on `:3001`.

`backend/.env.example` lists every variable the server reads. Only
`DATABASE_URL` and `JWT_SECRET` are needed to boot — mail, object storage, push
and error reporting all stay inert without credentials rather than failing.

### Some data to look at

```bash
cd backend && npm run seed:demo
```

### Tests

```bash
npm test
```

Ten suites. Each gets its own database, runs the real backend against it, and
drops it afterwards. See [`tests/README.md`](tests/README.md).

## A note on reading the code

The comments explain **why**, not what. Where something looks odd, the comment
usually says which bug produced it — a count rendered as `"01513 5"` because
Postgres returns `COUNT()` as a string, a question card without a `key` that
handed one person's half-typed follow-up to a question they had never seen, a
credits meter hidden below `sm` that left a phone showing six unexplained dots.

Most of those were found by someone using the product on a real phone rather
than by reading the code, which is worth knowing before you trust any part of
it too far.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Please do not open a public issue for anything
that affects user accounts or data.
