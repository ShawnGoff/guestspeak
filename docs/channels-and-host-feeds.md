# Channels, following, and host feeds

**Status:** spec, not built. All decisions made (§5). Build order in §6.

Two changes that belong together. Following consolidates onto channels, and
channels gain a feed where a host can put a question to their followers between
shows.

## 1. The model

> **Anyone can create a channel. Nobody is given one.**

A channel is the thing you build an audience on — a show, a station, a podcast.
Creating one is the signal that you want followers, and most accounts never
will. Someone running a single Q&A at a conference, a teacher doing one class
session, anyone trying the product once: none of them need a channel, and none
of them get one.

A host without a channel is not followable and has no feed. That is correct
rather than a gap — they did not ask for an audience.

An earlier draft of this had every account auto-created a channel, lazily, on
first session creation. That was wrong for the same reason: it forces an
ongoing-identity concept onto a one-off action, and leaves people with a thing
they will never open.

## 2. Following consolidates onto channels

`user_follows` goes away. `org_followers` is the only follow relationship.

Today there are two follow buttons that look identical and do materially
different things:

| | notifies on go-live | counts on a page | Discover strip |
|---|---|---|---|
| follow a **channel** | yes, in-app + email | yes | yes |
| follow a **person** | **no** | yes | yes |

`notifyOrgFollowers` opens with `if (!session.org_id) return;`, so a host
running sessions without a channel can never notify anyone regardless of how
many followers they have. Someone who follows a host expecting to hear when
they go on air never hears.

Removing person-follows does not fix that bug so much as **make it impossible**:
the only thing you can follow is the thing that has a notification path.

### What changes

- `DELETE /users/:username/follow` and its `POST` — removed.
- The follow button on `/u/:username` — removed. The profile becomes a plain
  identity page: username, join date, their public sessions.
- Discover's following feed reads `org_followers` instead of `user_follows`.
  It is already scoped to `visibility = 'public'`.
- `notifyOrgFollowers` keeps its `org_id` guard, but the guard now means
  "this session has no channel", not "this host cannot notify anyone".
- `user_follows` is dropped. Account deletion no longer needs to clean it up.

### The one thing it costs

A host who becomes popular has to create a channel to capture that, and will
want their existing sessions moved into it. Without a "move session to a
channel" affordance this is a support conversation. See §5.

## 3. Host feeds

A channel gets a feed. The host posts a prompt — *"Who would you like to see as
a guest?"* — and followers reply.

**The host opens every thread.** Followers reply to a prompt; they cannot start
one. That is the line that keeps this from becoming the open message board that
was explicitly ruled out: sessions are for live events, and this is a host
asking their audience something between them, not a permanent forum.

### Replies are not echoable — decided

Replies are a flat, chronological list. The host reads them.

Echoes were proposed and rejected. The argument for them was that a prompt with
plain replies is a comment section, while echoable replies would rank the
answers before the host arrives. The argument against is the one that wins:
echoes are what makes a **session** work, and spreading the mechanic across
every surface dilutes it. A live room where the best question rises is the
product; a channel feed is a place to ask your audience something between
shows.

This removes vote_count from channel_replies, the echo endpoint, and the
ranking work — the largest single piece of the build.

### Rules

- **Replying requires a registered account.** Not "must be following" —
  following is one click and reversible, so it is thin as a control. The real
  bar is the account, and guests cannot hold one.
- **One reply per person per prompt.** Same shape as the follow-up rule, and
  enforced the same way: a partial unique index, not a check-then-insert.
- **Replies are free.** No credits. There is no session, so there is no credit
  balance to draw on.
- **The word filter applies**, via the same `filterText` masking
  `createQuestion` uses. An edit path, if one is added later, must apply it too
  — that was a real bug in the question edit window.
- **The burst cooldown applies.** Free plus persistent plus notification-driven
  is the combination that attracts abuse, and there is no credit economy here
  to act as a brake.
- **Moderation applies.** Mute, ban and hide are session-scoped today and would
  need to reach channel-scoped content. This is day-one work, not later: with
  no credit friction it is the only brake there is.

### Schema sketch

```sql
CREATE TABLE channel_prompts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  closed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE channel_replies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id   UUID NOT NULL REFERENCES channel_prompts (id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users (id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'hidden')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One reply per person per prompt.
CREATE UNIQUE INDEX idx_channel_reply_once
  ON channel_replies (prompt_id, author_id)
  WHERE author_id IS NOT NULL;
```

`author_id` is `ON DELETE SET NULL` on replies, matching `questions`, so a
deleted account leaves the thread intact. It is `CASCADE` on prompts, because a
prompt with no author is not worth keeping.

**New tables rather than reusing `questions`.** `questions.session_id` is
`NOT NULL` and every feed, stat, export and moderation query joins through it.
A fake session to host channel content would surface in Discover, in channel
stats, and in CSV exports, and each of those would need a special case. Two
small tables are cheaper than that.

## 4. Upcoming shows on the feed

The other half of the original ask: the feed promotes upcoming sessions.

This needs no new storage. The channel page already lists upcoming and past
sessions, filtered to `visibility = 'public'`. Putting them in the feed
alongside prompts is a rendering decision — interleave by date, or a pinned
strip above the prompts.

Worth keeping the filter in mind: **unlisted sessions must not appear here.**
A feed entry carries the slug, and for an unlisted session the slug is its
entire access control. This is exactly the bug that was found and fixed in
Discover's following feed.

## 5. Decisions

**Moving a session into a channel — build it, but not day one.** Someone who
hosts before creating a channel ends up with their history sitting outside the
thing they made to showcase it. That is a real path — "this went well, now let
me organise it" — but it only affects people who host first and organise later,
and moving a session is a one-line update that can be done by hand for anyone
who asks until it earns a button.

**Profiles stay, but come out of the nav.** `/u/:username` is still worth
having when you click a host's name and want to see who they are. It is not
worth being a destination once there is nothing to do there. The follower count
comes off it, because following is a channel relationship now.

## 6. Build order

1. Drop person-follows: endpoints, profile button and follower count, Discover
   query, migration. Self-contained, and nothing else depends on it.
2. `channel_prompts` and `channel_replies`, host-posts and follower-replies.
3. Channel-scoped moderation: hide a reply, mute an author. Day one with the
   feed, not after it — free replies have no credit economy to slow them down.
4. Notify followers when a prompt is posted — same fire-and-forget shape as the
   go-live fan-out, plus a limit on how often a host can blast their followers.
5. Upcoming sessions rendered into the feed.
6. "Move session into a channel", once someone asks for it.
