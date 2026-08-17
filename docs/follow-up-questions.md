# Follow-up questions

**Status:** spec, not built. One product decision still open (§6) — whether a
free follow-up bypasses the guest sign-up wall. Expiry is settled: 24 hours
after the session closes.

When a host answers your question, you get to ask one follow-up, free of
credits. The point is the conversation an answer starts — *"you said X, but what
about Y?"* — which is the thing a flat queue of independent questions cannot do,
and the thing a nine-hour radio show is made of.

## 1. Why this is not a credit grant

The obvious implementation is "on answer, give the asker +1 credit." Don't.

A credit is fungible. It can be spent echoing someone else, or on an unrelated
question twenty minutes later. The intent — *respond to this answer* — is the
entire value of the feature, and dropping a credit into the balance discards it
on arrival.

It also drags a small feature through every edge case the credit system already
has: the rejected-question refund path, the regen ceiling, `regen_exhausted`,
the guest wall. Each becomes a special case, and each is a place to get it
wrong.

## 2. The model: a derived right on a threaded question

> You may post a follow-up to question Q, free, if you authored Q, Q is
> `answered`, and you have not already followed up on Q.

No token, no counter, no grant. The permission is a query over rows that already
exist, and the rows are the ledger.

That matters more than it sounds. There is nothing to double-spend, nothing to
refund, and nothing to reconcile against the credit tables. If a host reopens a
question the right silently reappears, because the query stops matching. If the
follow-up was already used, the unique index still holds. All of it falls out of
the constraint rather than out of code that has to remember.

### Schema

```sql
ALTER TABLE questions
  ADD COLUMN parent_question_id UUID REFERENCES questions (id) ON DELETE CASCADE,
  ADD COLUMN thread_root_id     UUID REFERENCES questions (id) ON DELETE CASCADE;

-- One follow-up per author per answered question. Partial, because
-- parent_question_id is NULL for every ordinary question and the identity
-- columns are mutually exclusive (see chk_vote_identity for the pattern).
CREATE UNIQUE INDEX idx_followup_once_user ON questions (parent_question_id, author_id)
  WHERE parent_question_id IS NOT NULL AND author_id IS NOT NULL;
CREATE UNIQUE INDEX idx_followup_once_guest ON questions (parent_question_id, author_guest_token)
  WHERE parent_question_id IS NOT NULL AND author_guest_token IS NOT NULL;

CREATE INDEX idx_questions_thread ON questions (thread_root_id) WHERE thread_root_id IS NOT NULL;
```

`author_id` is `ON DELETE SET NULL` and account deletion anonymises in place, so
a deleted author's thread survives with `author_display_name` doing the work it
already does elsewhere. Worth an explicit test.

### Chains, displayed flat

`parent_question_id` points at the specific answered question, so Q → F1 → F2
works for as long as the host keeps answering. That is the real shape of a
conversation.

`thread_root_id` groups the whole chain under the original, so the UI renders one
thread with a single level of nesting instead of a tree. Set it to
`parent.thread_root_id ?? parent.id` on insert.

**The host answering is the gate on the entire feature.** Nobody gets a free
question unless the host chose to answer them; a host who stops answering stops
the spigot. That is why no separate rate limit or depth cap is needed — and why
adding one would be a mistake, since it would cut off exactly the long exchange
the feature exists to enable.

## 3. Anonymity — build this in from the start

`post_anonymously` and `anon_number` (migration 016) mean an answered question
may be displayed as a numbered anonymous post.

If someone posts anonymously, gets answered, and then follows up under their
real name, threading the two **publicly links their account to the anonymous
question.** They did nothing wrong and the feature deanonymised them.

> A follow-up inherits the parent's anonymity. Same `post_anonymously`, same
> `anon_number` — not a fresh choice by the author, and not a fresh number.

This is much worse to retrofit than to build, because by then the linkage is
already in real sessions and already visible. Test it explicitly: post
anonymously, answer, follow up, assert the follow-up carries the parent's
`anon_number` and exposes no author identity in the feed payload.

The reverse — a named question followed up anonymously — leaks nothing, but
serves no purpose either. Inheriting in both directions is the simpler rule.

## 4. Free of credits is not free of rules

Everything that gates an ordinary question still gates a follow-up:

- `rejectIfMutedOrBanned` — a banned user must not get a private channel back
  into the room.
- The approval queue when the session has `requires_approval`.
- The burst cooldown.
- `questionLimiter`.

The only thing being waived is the credit cost. Skipping the moderation checks
along with it would turn "answer someone" into "grant them an unmoderated
channel," which is not a trade any host is choosing to make.

## 5. Surfacing

A follow-up dropped into the flat queue loses the point. Minimum viable:

- **Host view** — render the follow-up nested under its thread root, so the
  question and the answer that provoked it are read together.
- **Asker** — the affordance appears on their own answered question. It should
  read as a reply, not as a new submission, and should say plainly that it is
  free.
- **Feed payload** — `parent_question_id`, `thread_root_id`, and a
  `can_follow_up` boolean computed per caller, so the client does not re-derive
  the permission and drift from the server.

Echoes on follow-ups behave normally.

Sorting needs a decision: threads probably want to sort by the root's position
rather than each reply competing on its own `vote_count`, or an active thread
scatters itself across the feed.

## 6. Open decisions

**Does a free follow-up bypass the guest wall?** A guest at `regen_exhausted`
whose question just got answered on air — follow-up, or sign-up prompt?

Recommendation: give them the follow-up. Being answered is the high point of the
entire experience and the moment they are most likely to make an account
voluntarily; a paywall exactly there converts worse and reads as punitive. It
does not uncap guests, since the host still gates every follow-up. But it does
soften the funnel, and the funnel is deliberate — so this is a product call.

**Expiry.** ~~Recommendation: none within the session.~~ **Decided: 24 hours
after the session closes.**

Nothing expires while the show is running, so a listener who was away when their
question got answered still has it when they come back. The window then runs on
past the close, which is when someone catching up finds out they were answered
and has a day to respond — and it eventually shuts, so a session cannot be
reopened months later by a queue of stale follow-ups.

Enforce it against `ends_at`, which `closeSession` already stamps with `NOW()`
— there is no `closed_at`. Reading the timestamp rather than `status = 'closed'`
matters because a host who simply walks away never closes anything, and a
status check would leave the right open forever on an abandoned session. Worth
deciding what an abandoned session should do, since `ends_at` stays null there
too: either follow-ups stay open on it, or a session with a past `starts_at` and
no activity gets swept closed.

## 7. Build order

1. Migration — two columns, three indexes.
2. `createQuestion` accepts `parent_question_id`; derive the right, waive the
   credit, inherit anonymity, keep every other gate.
3. Feed payload — thread fields plus per-caller `can_follow_up`.
4. Host view nesting, then the asker's affordance.
5. Tests: the permission (author only, answered only, once only), the anonymity
   inheritance, moderation still applying, and a deleted author's thread.
