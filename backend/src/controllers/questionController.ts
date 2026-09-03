import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { broadcast, broadcastByRole, broadcastElevated } from '../sse/broadcaster';
import { resolveCallerRole, requireHostOrOrgAdmin, type CallerRole } from '../db/permissions';
import { filterText } from '../lib/wordFilter';
import { createNotificationsForUsers } from './notificationController';
import {
  fetchPublicQuestion,
  QUESTION_AUTHOR_SQL, QUESTION_AUTHOR_JOINS, QUESTION_MOD_COLUMNS,
} from '../lib/questionHelpers';
import { spendCredit } from '../lib/credits';
import { cacheKey, getCached, setCached, invalidateSession } from '../lib/feedCache';
type SortOption = 'echoes' | 'recent' | 'answered' | 'starred';

const CreateQuestionSchema = z.object({
  session_id: z.string().uuid(),
  body: z.string().min(1).max(300),
  post_anonymously: z.boolean().optional(),
  /** Set to follow up on your own answered question — free, and threaded to it. */
  parent_question_id: z.string().uuid().optional(),
});

/** How long after a session closes an earned follow-up can still be posted. */
const FOLLOW_UP_GRACE_HOURS = 24;

const StatusSchema = z.object({
  status: z.enum(['new', 'starred', 'answered', 'hidden']),
});

const FlagSchema = z.object({
  reason: z.enum(['spam', 'offensive', 'harassment', 'off_topic', 'other']),
});

/** Roles allowed to see hidden/pending questions and enter private sessions. */
const ELEVATED_ROLES: readonly string[] = ['host', 'org_owner', 'org_admin', 'moderator'];


export async function getQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = req.query.sessionId as string;
    const sort = (req.query.sort as SortOption) ?? 'echoes';
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!sessionId) throw new AppError(400, 'sessionId is required');

    const sessionResult = await pool.query(
      'SELECT visibility FROM sessions WHERE id = $1',
      [sessionId],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');

    // Hosts/mods can see hidden questions; everyone else cannot
    const callerId = req.user?.isGuest === false ? req.user.userId : null;
    let role: CallerRole = 'none';
    if (callerId) {
      ({ role } = await resolveCallerRole(sessionId, callerId));
    }
    const isElevated = ELEVATED_ROLES.includes(role);

    // Private sessions are readable only by elevated callers. Without this,
    // anyone holding the session UUID could read a private session's questions.
    if (sessionResult.rows[0].visibility === 'private' && !isElevated) {
      throw new AppError(403, 'This session is private');
    }

    const includeHidden = isElevated;

    // Cache only the plain audience feed. Elevated callers and status-filtered
    // queries (the moderation queue) must always hit the database — a mod acting
    // on a question has to see the result now, not after the TTL.
    const cacheable = !isElevated && !status;
    const key = cacheKey(sessionId, sort, limit, offset);
    if (cacheable) {
      const hit = getCached<{ data: unknown[]; limit: number; offset: number }>(key);
      if (hit) {
        res.json(hit);
        return;
      }
    }

    const conditions = ['q.session_id = $1'];
    if (!includeHidden) conditions.push("q.status NOT IN ('hidden', 'pending')");
    const params: unknown[] = [sessionId];

    if (status) {
      params.push(status);
      conditions.push(`q.status = $${params.length}`);
    }

    const orderMap: Record<SortOption, string> = {
      echoes: 'q.is_spotlighted DESC, q.is_pinned DESC, q.vote_count DESC, q.created_at DESC',
      recent: 'q.is_spotlighted DESC, q.is_pinned DESC, q.created_at DESC',
      answered: "q.is_spotlighted DESC, q.is_pinned DESC, CASE WHEN q.status = 'answered' THEN 0 ELSE 1 END, q.vote_count DESC",
      starred: "q.is_spotlighted DESC, q.is_pinned DESC, CASE WHEN q.status = 'starred' THEN 0 ELSE 1 END, q.vote_count DESC",
    };

    const orderBy = orderMap[sort] ?? orderMap.echoes;

    // Push limit/offset as the last params
    params.push(limit, offset);
    const limitClause = `LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(
      `SELECT q.id, q.body, q.status, q.is_pinned, q.is_spotlighted, q.vote_count,
              q.host_reply, q.host_replied_at, q.created_at, q.edited_at,
              q.parent_question_id, q.thread_root_id,
              q.post_anonymously, q.anon_number,
              ${QUESTION_AUTHOR_SQL} AS author_username,
              ${QUESTION_MOD_COLUMNS}
       FROM questions q
       ${QUESTION_AUTHOR_JOINS}
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}
       ${limitClause}`,
      params,
    );

    const payload = { data: result.rows, limit, offset };
    if (cacheable) setCached(key, payload);

    res.json(payload);
  } catch (err) {
    next(err);
  }
}

export async function createQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      session_id, body, post_anonymously: wantsAnon, parent_question_id: parentId,
    } = CreateQuestionSchema.parse(req.body);
    const userId = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;
    // Only registered users can post anonymously — guests are already pseudonymous
    const postAnonymously = !!(wantsAnon && userId);

    if (!userId && !guestToken) throw new AppError(401, 'Authentication required');

    // Verify session is open and accepting questions
    const sessionResult = await pool.query(
      `SELECT status, submission_cutoff_at, visibility, host_id, requires_approval,
              ends_at
         FROM sessions WHERE id = $1`,
      [session_id],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');

    const {
      status, submission_cutoff_at, visibility, host_id, requires_approval, ends_at,
    } = sessionResult.rows[0];

    // Resolve the caller's standing once. Guests can never hold an elevated
    // role, and the host is already known from the session row, so the extra
    // lookup only happens for other registered users.
    const isHostLevel = !!userId && userId === host_id;
    const isElevated = isHostLevel || (userId ? await callerIsElevated(session_id, userId) : false);

    // Block non-elevated users from submitting to private sessions.
    // Hosts and moderators are allowed; regular participants are not.
    if (visibility === 'private' && !isElevated) {
      throw new AppError(403, 'This session is private');
    }

    // Staff cannot post anonymously. Refused rather than ignored: silently
    // dropping the flag would publish their name on a question they asked to
    // be anonymous, which is the worse of the two failures.
    //
    // This is the enforcement, not the hidden toggle in the composer. Elevated
    // roles skip the credit deduction below, so an anonymous post from a host
    // drew from no pool at all — the 2-post anon allowance that bounds everyone
    // else simply did not apply to them.
    if (postAnonymously && isElevated) {
      throw new AppError(403, 'Hosts and moderators cannot post anonymously');
    }

    // A follow-up outlives both gates below, deliberately. The right is earned
    // by being answered, and someone answered near the end of a show — or who
    // only sees it afterwards — would otherwise lose it to a clock they had no
    // part in. It expires FOLLOW_UP_GRACE_HOURS after the session closed.
    //
    // ends_at is the close timestamp (closeSession stamps it, reopen clears
    // it), so an abandoned session that was never closed leaves it null and the
    // right stays open — which matches a session that is, as far as anyone can
    // tell, still running.
    if (!parentId) {
      if (status === 'closed') throw new AppError(410, 'Session is closed');
      if (submission_cutoff_at && new Date() > new Date(submission_cutoff_at)) {
        throw new AppError(403, 'Question submission has closed for this session');
      }
    } else if (ends_at) {
      const graceEnds = new Date(ends_at).getTime() + FOLLOW_UP_GRACE_HOURS * 3600_000;
      if (Date.now() > graceEnds) {
        throw new AppError(410, 'This session closed too long ago to follow up');
      }
    }

    // Everyone running the session — host, org owner/admin, assigned moderator —
    // bypasses join/ban/mute/burst and the credit economy. They are staffing the
    // room, not competing for airtime in it, and the UI shows them no credit
    // meter. Charging them meant they hit a hard 402 with nothing on screen to
    // explain it, and no heartbeat runs for elevated roles to ever regen it.
    if (!isElevated) {
      await verifyParticipant(session_id, userId, guestToken);
      await rejectIfMutedOrBanned(session_id, userId, guestToken, req.ip ?? null);
    }

    // Burst limit: 2 questions fire freely; if both land within BURST_WINDOW seconds
    // of each other, a BURST_COOLDOWN cooldown kicks in before the next one.
    // Questions spaced more than BURST_WINDOW seconds apart never trigger the cooldown.
    if (!isElevated) {
      const BURST_LIMIT    = 2;
      const BURST_WINDOW   = 10; // seconds — rapid-fire detection window
      const BURST_COOLDOWN = 30; // seconds — cooldown after hitting the limit
      const participantWhere = userId
        ? 'session_id = $1 AND user_id = $2'
        : 'session_id = $1 AND guest_token = $2';
      const participantParam = userId ?? guestToken;

      // Atomic update — allowed when:
      //   a) first question ever, OR
      //   b) cooldown expired (last question > BURST_COOLDOWN seconds ago), OR
      //   c) burst window expired (last question > BURST_WINDOW seconds ago — resets burst), OR
      //   d) within burst window but haven't hit the limit yet
      const burstResult = await pool.query(
        `UPDATE session_participants
         SET last_question_at = NOW(),
             question_burst = CASE
               WHEN last_question_at IS NULL
                 OR last_question_at < NOW() - INTERVAL '${BURST_COOLDOWN} seconds'
                 OR last_question_at < NOW() - INTERVAL '${BURST_WINDOW} seconds'
               THEN 1
               ELSE question_burst + 1
             END
         WHERE ${participantWhere}
           AND (
             last_question_at IS NULL
             OR last_question_at < NOW() - INTERVAL '${BURST_COOLDOWN} seconds'
             OR last_question_at < NOW() - INTERVAL '${BURST_WINDOW} seconds'
             OR question_burst < ${BURST_LIMIT}
           )
         RETURNING question_burst`,
        [session_id, participantParam],
      );

      if (!burstResult.rows[0]) {
        // Blocked — compute remaining cooldown from last_question_at
        const cooldownResult = await pool.query(
          `SELECT GREATEST(0, ${BURST_COOLDOWN} - EXTRACT(EPOCH FROM (NOW() - last_question_at))::int) AS secs
           FROM session_participants WHERE ${participantWhere}`,
          [session_id, participantParam],
        );
        const secs = cooldownResult.rows[0]?.secs ?? BURST_COOLDOWN;
        throw new AppError(429, `Slow down — you can ask again in ${secs}s`);
      }
    }

    // A follow-up is earned, not bought. The right is derived from rows that
    // already exist rather than stored as a token: you may follow up on Q if you
    // authored Q and Q is answered. Nothing to double-spend, nothing to refund,
    // and reopening a question quietly withdraws the right because the query
    // stops matching.
    //
    // "Once" is enforced by the unique indexes, not by a check here. Two taps
    // race through any check-then-insert, and the second would be free.
    let followUp: { parentId: string; threadRootId: string;
                    anon: boolean; anonNumber: number | null } | null = null;
    if (parentId) {
      const parent = await pool.query(
        `SELECT id, session_id, status, author_id, author_guest_token,
                post_anonymously, anon_number, thread_root_id
           FROM questions WHERE id = $1`,
        [parentId],
      );
      const q = parent.rows[0];
      if (!q || q.session_id !== session_id) throw new AppError(404, 'Question not found');

      const isAuthor = (userId && q.author_id === userId)
        || (guestToken && q.author_guest_token === guestToken);
      if (!isAuthor) throw new AppError(403, 'You can only follow up on your own question');
      if (q.status !== 'answered') {
        throw new AppError(409, 'You can follow up once this question has been answered');
      }

      followUp = {
        parentId: q.id,
        // Flat threading: the chain hangs off the original, not off its parent,
        // so the UI nests one level however long the exchange runs.
        threadRootId: q.thread_root_id ?? q.id,
        // Anonymity is inherited, never re-chosen. A named follow-up threaded
        // onto an answered anonymous question publicly links the account to the
        // anonymous post — the author did nothing wrong and the feature would
        // have deanonymised them.
        anon: q.post_anonymously,
        anonNumber: q.anon_number,
      };
    }

    // Deduct 1 credit — anon posts draw from a separate anon_credits pool (no replenishment),
    // regular posts draw from credits_remaining as normal.
    // Elevated roles are exempt (see above), and a follow-up costs nothing —
    // which is also how it bypasses the guest sign-up wall: the credit balance
    // is never consulted, so an exhausted guest can still answer back.
    if (isElevated || followUp) {
      // no credit cost
    } else if (postAnonymously) {
      const col = userId ? 'user_id' : 'guest_token';
      const val = userId ?? guestToken;
      const anonResult = await pool.query(
        `UPDATE session_participants
         SET anon_credits = anon_credits - 1
         WHERE session_id = $1 AND ${col} = $2 AND anon_credits > 0
         RETURNING anon_credits`,
        [session_id, val],
      );
      if (anonResult.rowCount === 0) {
        throw new AppError(402, 'Anonymous posting limit reached — post with your name to continue');
      }
    } else {
      await spendCredit(session_id, userId, guestToken);
    }

    // Apply word filter — stored body is always clean
    const cleanBody = await filterText(body);

    // If the session requires host approval, questions start as 'pending'
    // and are invisible to the audience until approved.
    const initialStatus = requires_approval ? 'pending' : 'new';

    // For anon posts, atomically claim the next anon number for this session.
    // A follow-up reuses the parent's number instead of taking a new one, so a
    // thread reads as one Anon rather than several.
    let anonNumber: number | null = followUp?.anonNumber ?? null;
    if (postAnonymously && !followUp) {
      const counterResult = await pool.query(
        `UPDATE sessions SET anon_counter = anon_counter + 1 WHERE id = $1 RETURNING anon_counter`,
        [session_id],
      );
      anonNumber = counterResult.rows[0].anon_counter;
    }

    // Snapshot the byline. It is a fact about who posted this, at the time they
    // posted it — not a live lookup. Resolving it later broke when a guest was
    // removed (their participant row is deleted) or renamed (the row is updated),
    // in both cases silently rewriting history on questions already on screen.
    const isAnon = followUp ? followUp.anon : postAnonymously;
    const authorDisplayName = isAnon
      ? null
      : await resolveAuthorDisplayName(session_id, userId, guestToken);

    let result;
    try {
      result = await pool.query(
        `INSERT INTO questions (session_id, author_id, author_guest_token, body, status,
                                post_anonymously, anon_number, author_display_name,
                                parent_question_id, thread_root_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [session_id, userId, guestToken, cleanBody, initialStatus, isAnon, anonNumber,
         authorDisplayName, followUp?.parentId ?? null, followUp?.threadRootId ?? null],
      );
    } catch (err) {
      // 23505 here is one of the idx_followup_once_* indexes: the follow-up was
      // already used. The database is the only place that can say so without a
      // race, which is why it is caught rather than pre-checked.
      if ((err as { code?: string }).code === '23505' && followUp) {
        throw new AppError(409, 'You have already followed up on that question');
      }
      throw err;
    }

    const newId = result.rows[0].id;
    const publicQuestion = await fetchPublicQuestion(newId, session_id);

    // C4: only broadcast approved questions — pending ones wait for host approval
    invalidateSession(session_id);
    if (initialStatus === 'pending') {
      // Pending questions go to hosts/mods only — they need to appear in the
      // approval queue the moment they arrive, without the room seeing them
      // before they are approved.
      broadcastElevated(session_id, { type: 'question:pending', data: publicQuestion });
    } else {
      broadcast(session_id, { type: 'question:new', data: publicQuestion });
    }

    res.status(201).json(publicQuestion);
  } catch (err) {
    next(err);
  }
}

export async function updateQuestionStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { status } = StatusSchema.parse(req.body);
    const callerId = req.user!.userId;

    // Look up question + session
    const qResult = await pool.query(
      `SELECT q.session_id, q.status AS current_status, q.author_id,
              q.author_guest_token, q.post_anonymously, s.host_id
       FROM questions q
       JOIN sessions s ON s.id = q.session_id WHERE q.id = $1`,
      [id],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');

    const {
      session_id, current_status, author_id, author_guest_token, post_anonymously,
    } = qResult.rows[0];
    const { role, permissions } = await resolveCallerRole(session_id, callerId);

    if (role === 'participant' || role === 'none') {
      throw new AppError(403, 'Insufficient permissions');
    }

    // Hosts, org owners, and org admins have full rights.
    // Explicit moderators must have the specific permission.
    if (role === 'moderator') {
      const permCol = transitionToPermColumn(current_status, status) as keyof typeof permissions;
      if (!permissions[permCol]) {
        throw new AppError(403, 'Insufficient permissions');
      }
    }

    // $1 was previously used both as the assigned value and inside the CASE
    // comparison. status is varchar(20) but a comparison against a literal
    // deduces text, so Postgres could not settle on one type for the parameter
    // and every call failed with 42P08 — hide, star, and mark-answered included.
    // The spotlight decision is made here and passed as its own boolean.
    await pool.query(
      `UPDATE questions
       SET status = $1,
           is_spotlighted = CASE WHEN $2 THEN false ELSE is_spotlighted END,
           updated_at = NOW()
       WHERE id = $3`,
      [status, status === 'answered', id],
    );

    // Rejecting a question that never reached the audience refunds its credit.
    // The author paid to ask, a moderator declined to publish it, and without
    // this they are just down a credit with nothing to show for it and no
    // explanation. Scoped to pending -> hidden: hiding an already-published
    // question moderates content the author did get airtime for, and must not
    // pay them back.
    // Echoers are deliberately not refunded, here or anywhere. This is a
    // decision, not a gap — the absence of code is easy to mistake for one.
    //
    // The rule above is that a credit comes back when the spend never reached
    // the audience. An echo on a published question did reach it: it moved the
    // ranking and shaped what the host saw, and the question being removed
    // later does not undo the signal it already sent. Refunding would also hand
    // every echoer a credit back the instant a host moderates something, which
    // is a burst of new questions arriving exactly while they deal with a
    // problem — and un-hiding would have to charge it all again, against people
    // who may have spent it by then.
    //
    // The question simply disappears from the feed, and the people who echoed
    // it are not told. That is what every other site does with a removed post,
    // and the loss here is one credit that comes back on the next regen tick.
    if (current_status === 'pending' && status === 'hidden') {
      await refundQuestionCredit(session_id, author_id, author_guest_token, post_anonymously);
    }

    const publicQuestion = await fetchPublicQuestion(id, session_id);

    invalidateSession(session_id);

    if (status === 'hidden') {
      // Don't push the body of a just-hidden question to every connected
      // browser. Mods need it for their panel; the audience gets a bare id so
      // their client can drop it.
      broadcastByRole(
        session_id,
        { type: 'question:updated', data: publicQuestion },
        { type: 'question:removed', data: { id } },
      );
    } else {
      broadcast(session_id, { type: 'question:updated', data: publicQuestion });
    }

    res.json(publicQuestion);
  } catch (err) {
    next(err);
  }
}

export async function addEcho(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: questionId } = req.params;
    const userId = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;

    if (!userId && !guestToken) throw new AppError(401, 'Authentication required to Echo');

    const qResult = await pool.query(
      `SELECT q.session_id, q.author_id, q.author_guest_token,
              q.status AS question_status, s.status
       FROM questions q
       JOIN sessions s ON s.id = q.session_id
       WHERE q.id = $1`,
      [questionId],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');

    const { session_id, author_id, author_guest_token, question_status, status } = qResult.rows[0];

    // A closed session is closed to echoing too. Submission already returned 410
    // here, but echoes did not check at all, so vote counts kept moving after the
    // host ended the session — shifting the ranking underneath a host who had
    // already read the top questions, and drifting from the CSV they exported.
    if (status === 'closed') throw new AppError(410, 'Session is closed');

    // Only what the audience can actually see can be echoed. This checked the
    // session's status but never the question's, so a credit could be spent on
    // a question that was hidden or still waiting for approval — invisible in
    // the feed, but echoable by id. The realistic version is not an attack: a
    // listener's feed goes stale, the host hides something, and their next tap
    // buys a vote on a question nobody will ever see. Rejection refunds the
    // author and has no idea the echoers exist.
    if (question_status === 'hidden' || question_status === 'pending') {
      throw new AppError(409, 'That question is no longer available');
    }

    // Prevent self-echo
    if (userId && userId === author_id) throw new AppError(409, 'You cannot Echo your own question');
    if (guestToken && guestToken === author_guest_token) throw new AppError(409, 'You cannot Echo your own question');

    // Session staff echo without cost, matching question submission: the UI shows
    // them no credit meter and no heartbeat regenerates credits for them.
    const isElevated = userId ? await callerIsElevated(session_id, userId) : false;

    if (!isElevated) {
      await verifyParticipant(session_id, userId, guestToken);
      // Reject muted, session-banned, or platform-banned users (pass IP for platform ban check)
      await rejectIfMutedOrBanned(session_id, userId, guestToken, req.ip ?? null);
    }

    // Wrap credit spend + vote insert in a transaction.
    // Spend credit FIRST so a failed spend never lets the vote land.
    const col = userId ? 'user_id' : 'guest_token';
    const val = userId ?? guestToken;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deduct credit — rolls back everything if user is out
      if (!isElevated) {
        try {
          await spendCredit(session_id, userId, guestToken, client);
        } catch (err) {
          await client.query('ROLLBACK', []);
          throw err;
        }
      }

      // Insert vote — unique constraint catches duplicate echoes
      await client.query(
        `INSERT INTO votes (question_id, user_id, guest_token) VALUES ($1, $2, $3)`,
        [questionId, userId, guestToken],
      );

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (err?.code === '23505') throw new AppError(409, 'You have already Echoed this question');
      throw err;
    } finally {
      client.release();
    }

    // vote_count updated by DB trigger; fetch fresh value
    const updated = await pool.query(
      'SELECT vote_count FROM questions WHERE id = $1',
      [questionId],
    );
    const { vote_count } = updated.rows[0];

    invalidateSession(session_id);
    broadcast(session_id, { type: 'echo:added', data: { questionId, vote_count } });

    res.json({ vote_count });
  } catch (err) {
    next(err);
  }
}

export async function flagQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: questionId } = req.params;
    const { reason } = FlagSchema.parse(req.body);
    const userId = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;

    if (!userId && !guestToken) throw new AppError(401, 'Authentication required to flag');

    const qResult = await pool.query(
      'SELECT session_id FROM questions WHERE id = $1',
      [questionId],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');

    const sessionId = qResult.rows[0].session_id;

    // Flagging is a moderation signal, so it must come from someone actually in
    // the session and in good standing. Without this, minting throwaway guest
    // tokens is enough to bury any question under fake reports.
    await verifyParticipant(sessionId, userId, guestToken);
    await rejectIfMutedOrBanned(sessionId, userId, guestToken, req.ip ?? null);

    let isModeratorFlag = false;
    if (userId) {
      const modResult = await pool.query(
        `SELECT can_flag FROM session_moderators WHERE session_id = $1 AND user_id = $2`,
        [sessionId, userId],
      );
      isModeratorFlag = modResult.rows[0]?.can_flag === true;
    }

    await pool.query(
      `INSERT INTO flags (question_id, user_id, guest_token, reason, is_moderator_flag)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [questionId, userId, guestToken, reason, isModeratorFlag],
    );

    res.status(201).json({ flagged: true });
  } catch (err) {
    next(err);
  }
}

export async function searchSimilar(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = req.query.sessionId as string;
    const q = req.query.q as string;

    if (!sessionId || !q) throw new AppError(400, 'sessionId and q are required');
    if (q.trim().length < 4) {
      res.json([]);
      return;
    }

    // Block non-hosts from searching private session questions
    const sessionResult = await pool.query(
      'SELECT visibility, host_id FROM sessions WHERE id = $1',
      [sessionId],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');

    const { visibility, host_id } = sessionResult.rows[0];
    const callerId = req.user?.isGuest === false ? req.user.userId : null;
    if (visibility === 'private' && callerId !== host_id) {
      throw new AppError(403, 'This session is private');
    }

    // websearch_to_tsquery is forgiving of arbitrary user input (unlike to_tsquery)
    const result = await pool.query(
      `SELECT id, body, vote_count, status
       FROM questions
       WHERE session_id = $1
         AND status != 'hidden'
         AND to_tsvector('english', body) @@ websearch_to_tsquery('english', $2)
       ORDER BY vote_count DESC
       LIMIT 5`,
      [sessionId, q.trim()],
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/questions/:id/approve — host/mod approves a pending question */
export async function approveQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const callerId = req.user!.userId;

    const qResult = await pool.query(
      `SELECT q.session_id, q.status FROM questions q WHERE q.id = $1`,
      [id],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');
    const { session_id, status: qStatus } = qResult.rows[0];
    if (qStatus !== 'pending') throw new AppError(400, 'Question is not pending approval');

    const { role, permissions } = await resolveCallerRole(session_id, callerId);
    if (role === 'participant' || role === 'none') throw new AppError(403, 'Insufficient permissions');
    if (role === 'moderator' && !permissions.can_approve) throw new AppError(403, 'Insufficient permissions');

    await pool.query(
      `UPDATE questions SET status = 'new', updated_at = NOW() WHERE id = $1`,
      [id],
    );
    const publicQuestion = await fetchPublicQuestion(id, session_id);
    invalidateSession(session_id);
    broadcast(session_id, { type: 'question:new', data: publicQuestion });
    res.json(publicQuestion);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/questions/:id/pin — host/org_admin toggles pin */
export async function pinQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const callerId = req.user!.userId;

    const qResult = await pool.query(
      `SELECT q.session_id, q.is_pinned FROM questions q WHERE q.id = $1`,
      [id],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');
    const { session_id, is_pinned } = qResult.rows[0];

    await requireHostOrOrgAdmin(session_id, callerId);

    await pool.query(
      `UPDATE questions SET is_pinned = $1, updated_at = NOW() WHERE id = $2`,
      [!is_pinned, id],
    );

    invalidateSession(session_id);

    const publicQuestion = await fetchPublicQuestion(id, session_id);
    broadcast(session_id, { type: 'question:updated', data: publicQuestion });
    res.json(publicQuestion);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/questions/:id/spotlight — host/org_admin toggles Now Answering spotlight.
 *  Only one question can be spotlighted per session at a time; spotlighting a new one
 *  automatically clears any previous spotlight.
 */
export async function spotlightQuestion(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const callerId = req.user!.userId;

    const qResult = await pool.query(
      `SELECT q.session_id, q.is_spotlighted FROM questions q WHERE q.id = $1`,
      [id],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');
    const { session_id, is_spotlighted } = qResult.rows[0];

    await requireHostOrOrgAdmin(session_id, callerId);

    // Single statement: clear all spotlighted in session (except target), then toggle target
    const result = await pool.query(
      `WITH cleared AS (
         UPDATE questions SET is_spotlighted = false, updated_at = NOW()
         WHERE session_id = $1 AND is_spotlighted = true AND id != $2
       )
       UPDATE questions SET is_spotlighted = NOT is_spotlighted, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [session_id, id],
    );

    const nowSpotlighted: boolean = result.rows[0].is_spotlighted;

    invalidateSession(session_id);

    // session:spotlight tells all clients which question (or null) is now spotlighted
    broadcast(session_id, {
      type: 'session:spotlight',
      data: { question_id: nowSpotlighted ? id : null },
    });

    // Re-read through the full projection rather than serialising the RETURNING *
    // row: a bare question row carries no join data, so it cannot fall back to a
    // live byline lookup when the snapshot is null.
    const publicQuestion = await fetchPublicQuestion(id, session_id);
    res.json(publicQuestion);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/questions/:id/reply — host or org_admin adds a post-session reply */
export async function addHostReply(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { reply } = z.object({ reply: z.string().min(1).max(2000) }).parse(req.body);
    const callerId = req.user!.userId;

    const qResult = await pool.query(
      `SELECT q.session_id, q.author_id, q.host_reply,
              s.title AS session_title, s.slug AS session_slug
       FROM questions q
       JOIN sessions s ON s.id = q.session_id
       WHERE q.id = $1`,
      [id],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');
    const { session_id, author_id, host_reply: existingReply, session_title, session_slug } = qResult.rows[0];

    await requireHostOrOrgAdmin(session_id, callerId);

    await pool.query(
      `UPDATE questions
       SET host_reply = $1, host_replied_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [reply, id],
    );

    invalidateSession(session_id);

    const publicQuestion = await fetchPublicQuestion(id, session_id);
    broadcast(session_id, { type: 'question:updated', data: publicQuestion });
    res.json(publicQuestion);

    // Notify the question author (registered users only, first reply only, not replying to yourself)
    if (author_id && author_id !== callerId && !existingReply) {
      createNotificationsForUsers([author_id], 'question:replied', {
        session_id,
        session_slug,
        session_title,
        question_id: id,
      }).catch(() => {});
    }
  } catch (err) {
    next(err);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * The name to record on a question at post time.
 *
 * Registered users are named by their account; guests by the display name they
 * joined this session under. Returns null only if neither resolves, in which
 * case the read path falls back to a generic label.
 */
async function resolveAuthorDisplayName(
  sessionId: string,
  userId: string | null,
  guestToken: string | null,
): Promise<string | null> {
  if (userId) {
    const result = await pool.query(
      'SELECT username FROM users WHERE id = $1',
      [userId],
    );
    return result.rows[0]?.username ?? null;
  }

  if (guestToken) {
    const result = await pool.query(
      'SELECT guest_username FROM session_participants WHERE session_id = $1 AND guest_token = $2',
      [sessionId, guestToken],
    );
    return result.rows[0]?.guest_username ?? null;
  }

  return null;
}

/**
 * True when the caller runs the session (host, org owner/admin, or an assigned
 * moderator). Session staff bypass the participant economy — credits, burst
 * limits, and join checks all apply to the audience, not to the people
 * moderating it.
 */
async function callerIsElevated(sessionId: string, userId: string): Promise<boolean> {
  const { role } = await resolveCallerRole(sessionId, userId);
  return ELEVATED_ROLES.includes(role);
}

/**
 * Throws 403 if user/guest does not have a participant row for the session.
 * Guests must call POST /sessions/:id/join before they can act.
 */
async function verifyParticipant(
  sessionId: string,
  userId: string | null,
  guestToken: string | null,
) {
  const col = userId ? 'user_id' : 'guest_token';
  const val = userId ?? guestToken;

  const result = await pool.query(
    `SELECT id FROM session_participants WHERE session_id = $1 AND ${col} = $2`,
    [sessionId, val],
  );

  if (result.rowCount === 0) {
    throw new AppError(403, 'You must join the session before participating');
  }
}

/**
 * Throws 403 if the participant is muted, session-banned, or platform-banned.
 * Checks platform_bans so bans take effect immediately — not just at join time.
 * ipAddress is optional: pass req.ip when available to enforce IP-level bans.
 */
async function rejectIfMutedOrBanned(
  sessionId: string,
  userId: string | null,
  guestToken: string | null,
  ipAddress: string | null = null,
) {
  const col = userId ? 'user_id' : 'guest_token';
  const val = userId ?? guestToken;

  // One round trip, not three. This runs on every question and every echo, so at
  // venue scale the difference is three connections held per action instead of
  // one against a 20-connection pool.
  const params: unknown[] = [sessionId, val];

  // Platform bans are matched on user_id, guest_token, AND IP so all three ban
  // vectors are enforced. Built dynamically because a guest has no user_id and a
  // proxied request may have no IP.
  const banConditions: string[] = [];
  if (userId) {
    params.push(userId);
    banConditions.push(`user_id = $${params.length}`);
  }
  if (guestToken) {
    params.push(guestToken);
    banConditions.push(`guest_token = $${params.length}`);
  }
  if (ipAddress) {
    params.push(ipAddress);
    banConditions.push(`ip_address = $${params.length}`);
  }
  // `FALSE` keeps the SQL valid when there is nothing to match on.
  const banWhere = banConditions.length ? banConditions.join(' OR ') : 'FALSE';

  const result = await pool.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM session_participants
         WHERE session_id = $1 AND ${col} = $2 AND is_muted
       ) AS muted,
       EXISTS (
         SELECT 1 FROM session_bans
         WHERE session_id = $1 AND ${col} = $2
       ) AS session_banned,
       EXISTS (
         SELECT 1 FROM platform_bans
         WHERE (${banWhere}) AND (expires_at IS NULL OR expires_at > NOW())
       ) AS platform_banned`,
    params,
  );

  const { muted, session_banned, platform_banned } = result.rows[0];

  // Order preserved from the original sequential checks — the most specific
  // explanation wins.
  if (muted)           throw new AppError(403, 'You have been muted in this session');
  if (session_banned)  throw new AppError(403, 'You have been removed from this session');
  if (platform_banned) throw new AppError(403, 'Your account has been suspended');
}

/**
 * Return the credit spent on a question that was rejected before publication.
 *
 * Mirrors exactly what createQuestion charged:
 *  - anonymous posts drew from anon_credits and did not touch actions_used
 *  - everything else drew from credits_remaining and incremented actions_used
 *
 * Session staff are skipped. They are exempt from the credit economy, so they
 * were never charged, and crediting them would mint credits from nothing.
 *
 * A missing participant row (the author was removed from the session) is not an
 * error — there is simply nobody left to refund, and the moderator's action
 * should still succeed.
 */
async function refundQuestionCredit(
  sessionId: string,
  authorId: string | null,
  authorGuestToken: string | null,
  postAnonymously: boolean,
): Promise<void> {
  if (!authorId && !authorGuestToken) return;

  // Guests can never be elevated, so only registered authors need the lookup.
  if (authorId && await callerIsElevated(sessionId, authorId)) return;

  const col = authorId ? 'user_id' : 'guest_token';
  const val = authorId ?? authorGuestToken;

  if (postAnonymously) {
    await pool.query(
      `UPDATE session_participants
       SET anon_credits = anon_credits + 1
       WHERE session_id = $1 AND ${col} = $2`,
      [sessionId, val],
    );
    return;
  }

  // Clamped to the host's ceiling. A question sits in the approval queue for as
  // long as a moderator takes to reach it, and regeneration keeps running in the
  // meantime — so an author could be back at the cap by the time their question
  // is rejected, and an unclamped refund pushed them past it. Measured at 7 in a
  // 6-credit session. Being at the cap already means nothing was lost.
  await pool.query(
    `UPDATE session_participants p
     SET credits_remaining = LEAST(p.credits_remaining + 1, s.credits_per_user),
         actions_used      = GREATEST(p.actions_used - 1, 0)
     FROM sessions s
     WHERE s.id = p.session_id
       AND p.session_id = $1 AND p.${col} = $2`,
    [sessionId, val],
  );
}


/**
 * Maps a status transition to the moderator permission it requires.
 *
 * The target status alone is not enough: setting a question back to 'new' means
 * "reopen" when it was answered/starred, but "un-hide" when it was hidden. Those
 * are different powers, so un-hiding is gated on can_hide — otherwise a mod with
 * only can_mark_answered could reveal anything a host had hidden.
 */
function transitionToPermColumn(currentStatus: string, nextStatus: string): string {
  if (currentStatus === 'hidden') return 'can_hide';

  const map: Record<string, string> = {
    answered: 'can_mark_answered',
    new:      'can_mark_answered', // reopening an answered question
    starred:  'can_star',
    hidden:   'can_hide',
    flagged:  'can_flag',
  };
  return map[nextStatus] ?? 'can_hide'; // fail closed on an unmapped status
}

/** How long after posting an author may still fix their own wording. */
const EDIT_WINDOW_SECONDS = 60;

const EditQuestionSchema = z.object({
  body: z.string().min(1).max(300),
});

/**
 * PATCH /api/questions/:id
 *
 * Lets the author correct their own question for EDIT_WINDOW_SECONDS after
 * posting. Nobody else can, including the host: rewriting someone's question
 * puts words in their mouth, and a host who dislikes the wording can hide it.
 *
 * The window is enforced in the UPDATE rather than checked first. A read then a
 * write leaves a gap where a question can be echoed, approved, or hidden in
 * between, and the whole point of the deadline is that it is the moment the
 * words stop being the author's alone.
 *
 * Hidden questions are excluded outright. A removed question is not a draft to
 * revise, and an author must not be able to quietly rewrite one and have it
 * restored later as something else.
 *
 * Pending questions have no deadline. The window exists because a published
 * question has already been read and echoed, so editing it rewrites something
 * other people responded to. A question waiting for approval has been read by
 * nobody but the host, so none of that holds — and the clock ran anyway, which
 * made a typo permanent sixty seconds into a queue that might not be cleared
 * for ten minutes. Approval sets the status, so the normal window applies from
 * the moment the room can see it.
 */
export async function updateQuestionBody(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { body } = EditQuestionSchema.parse(req.body);
    const userId = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;

    if (!userId && !guestToken) throw new AppError(401, 'Authentication required');

    // Same masking createQuestion applies. Without it the edit window is a way
    // round the filter: post something clean, then rewrite it into whatever the
    // list exists to catch.
    const cleanBody = await filterText(body);

    const result = await pool.query(
      `UPDATE questions
          SET body = $1, edited_at = NOW(), updated_at = NOW()
        WHERE id = $2
          AND status <> 'hidden'
          AND (status = 'pending'
               OR created_at > NOW() - INTERVAL '${EDIT_WINDOW_SECONDS} seconds')
          AND (author_id = $3 OR author_guest_token = $4)
        RETURNING session_id`,
      [cleanBody, id, userId, guestToken],
    );

    // Nothing matched. Work out which rule stopped it so the message is worth
    // reading — "not found" for someone else's question would be a lie, and
    // "too late" for a question that never existed would be confusing.
    if (result.rowCount === 0) {
      const q = await pool.query(
        `SELECT author_id, author_guest_token, status,
                status <> 'pending'
                  AND created_at <= NOW() - INTERVAL '${EDIT_WINDOW_SECONDS} seconds' AS expired
           FROM questions WHERE id = $1`,
        [id],
      );
      const row = q.rows[0];
      if (!row) throw new AppError(404, 'Question not found');
      const isAuthor = (userId && row.author_id === userId)
        || (guestToken && row.author_guest_token === guestToken);
      if (!isAuthor) throw new AppError(403, 'You can only edit your own question');
      if (row.status === 'hidden') throw new AppError(409, 'That question is no longer available');
      if (row.expired) {
        throw new AppError(409, `Questions can only be edited for ${EDIT_WINDOW_SECONDS} seconds after posting`);
      }
      throw new AppError(409, 'That question can no longer be edited');
    }

    const { session_id } = result.rows[0];
    const publicQuestion = await fetchPublicQuestion(id, session_id);

    invalidateSession(session_id);
    broadcast(session_id, { type: 'question:updated', data: publicQuestion });

    res.json(publicQuestion);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/sessions/:id/mine — which questions in this session are the
 * caller's own.
 *
 * Its own endpoint rather than an `is_mine` column on the feed, because the
 * audience feed is cached on (session, sort, limit, offset) with no caller in
 * the key. A per-caller field there would be served to whoever asked next,
 * which is both wrong and a disclosure of who wrote what.
 *
 * The client used to derive this from sessionStorage — only the questions you
 * posted in that tab counted as yours. That is fine until the tab closes, and
 * the follow-up right is deliberately good for FOLLOW_UP_GRACE_HOURS after the
 * session ends. Anyone taking the product up on that came back the next day to
 * a fresh tab, an empty set, and no follow-up button on a question the server
 * would still have accepted one for.
 *
 * Never cached: the answer differs per caller and changes as they post.
 */
export async function listMyQuestionIds(req: Request, res: Response, next: NextFunction) {
  try {
    const { id: sessionId } = req.params;
    const userId = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;

    // Anonymous with no identity at all owns nothing. Not an error — a fresh
    // visitor asks this before they have posted anything.
    if (!userId && !guestToken) {
      res.json({ ids: [] });
      return;
    }

    const result = await pool.query(
      `SELECT id FROM questions
        WHERE session_id = $1
          AND (($2::uuid IS NOT NULL AND author_id = $2)
            OR ($3::text IS NOT NULL AND author_guest_token = $3))`,
      [sessionId, userId, guestToken],
    );

    // The caller's own questions still waiting for approval, in full.
    //
    // The public feed hides pending questions from everyone but session staff,
    // which is the point of an approval queue — but it hid them from their own
    // author too. You asked something, the screen said "No questions yet", and
    // there was nothing to edit and no sign it had been received at all.
    //
    // It goes here rather than into the feed because the feed is cached on
    // (session, sort, limit, offset) with no caller in the key, so a row that
    // belongs to one person would be served to whoever asked next. This
    // endpoint is already per-caller and uncached.
    const pending = await pool.query(
      `SELECT q.id, q.body, q.status, q.is_pinned, q.is_spotlighted, q.vote_count,
              q.host_reply, q.host_replied_at, q.created_at, q.edited_at,
              q.parent_question_id, q.thread_root_id,
              q.post_anonymously, q.anon_number,
              ${QUESTION_AUTHOR_SQL} AS author_username
         FROM questions q
         ${QUESTION_AUTHOR_JOINS}
        WHERE q.session_id = $1
          AND q.status = 'pending'
          AND (($2::uuid IS NOT NULL AND q.author_id = $2)
            OR ($3::text IS NOT NULL AND q.author_guest_token = $3))
        ORDER BY q.created_at DESC`,
      [sessionId, userId, guestToken],
    );

    // Which questions this caller has already echoed.
    //
    // The client used to know this only for echoes made in the current tab —
    // nothing loaded it back. So a reload offered the Echo button again on
    // questions you had already echoed, and pressing it earned an error from
    // the server, which is the one place a person is certain they did nothing
    // wrong. Same shape of bug as the follow-up right that did not survive a
    // new tab.
    const echoed = await pool.query(
      `SELECT v.question_id
         FROM votes v
         JOIN questions q ON q.id = v.question_id
        WHERE q.session_id = $1
          AND (($2::uuid IS NOT NULL AND v.user_id = $2)
            OR ($3::text IS NOT NULL AND v.guest_token = $3))`,
      [sessionId, userId, guestToken],
    );

    res.json({
      ids: result.rows.map((r: { id: string }) => r.id),
      pending: pending.rows,
      echoed: echoed.rows.map((r: { question_id: string }) => r.question_id),
    });
  } catch (err) {
    next(err);
  }
}
