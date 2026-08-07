import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { broadcast, broadcastByRole, broadcastElevated } from '../sse/broadcaster';
import { resolveCallerRole, requireHostOrOrgAdmin, type CallerRole } from '../db/permissions';
import { filterText } from '../lib/wordFilter';
import { createNotificationsForUsers } from './notificationController';
import { fetchPublicQuestion, toPublicQuestion } from '../lib/questionHelpers';
import { cacheKey, getCached, setCached, invalidateSession } from '../lib/feedCache';
type SortOption = 'echoes' | 'recent' | 'answered' | 'starred';

const CreateQuestionSchema = z.object({
  session_id: z.string().uuid(),
  body: z.string().min(1).max(300),
  post_anonymously: z.boolean().optional(),
});

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
              q.host_reply, q.host_replied_at, q.created_at,
              q.post_anonymously, q.anon_number,
              -- For anon posts: return "Anon{n}" as the display name; hide real identity from everyone.
              -- Named posts read the snapshot taken at post time, so removing or
              -- renaming a guest never rewrites bylines already on screen.
              CASE
                WHEN q.post_anonymously THEN 'Anon' || q.anon_number
                ELSE COALESCE(q.author_display_name, 'Removed participant')
              END AS author_username,
              -- participant_id and is_muted only for non-anon posts (avoids identity-via-mod-action)
              CASE WHEN q.post_anonymously THEN NULL ELSE sp.id END AS participant_id,
              CASE WHEN q.post_anonymously THEN NULL ELSE sp.is_muted END AS author_is_muted
       FROM questions q
       LEFT JOIN users u ON u.id = q.author_id AND NOT q.post_anonymously
       LEFT JOIN session_participants sp
         ON sp.session_id = q.session_id
         AND NOT q.post_anonymously
         AND (
           (q.author_guest_token IS NOT NULL AND sp.guest_token = q.author_guest_token)
           OR
           (q.author_id IS NOT NULL AND sp.user_id = q.author_id)
         )
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
    const { session_id, body, post_anonymously: wantsAnon } = CreateQuestionSchema.parse(req.body);
    const userId = req.user?.isGuest === false ? req.user.userId : null;
    const guestToken = req.user?.guestToken ?? null;
    // Only registered users can post anonymously — guests are already pseudonymous
    const postAnonymously = !!(wantsAnon && userId);

    if (!userId && !guestToken) throw new AppError(401, 'Authentication required');

    // Verify session is open and accepting questions
    const sessionResult = await pool.query(
      'SELECT status, submission_cutoff_at, visibility, host_id, requires_approval FROM sessions WHERE id = $1',
      [session_id],
    );
    if (!sessionResult.rows[0]) throw new AppError(404, 'Session not found');

    const { status, submission_cutoff_at, visibility, host_id, requires_approval } = sessionResult.rows[0];

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

    if (status === 'closed') throw new AppError(410, 'Session is closed');
    if (
      submission_cutoff_at &&
      new Date() > new Date(submission_cutoff_at)
    ) {
      throw new AppError(403, 'Question submission has closed for this session');
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

    // Deduct 1 credit — anon posts draw from a separate anon_credits pool (no replenishment),
    // regular posts draw from credits_remaining as normal.
    // Elevated roles are exempt (see above).
    if (isElevated) {
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

    // For anon posts, atomically claim the next anon number for this session
    let anonNumber: number | null = null;
    if (postAnonymously) {
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
    const authorDisplayName = postAnonymously
      ? null
      : await resolveAuthorDisplayName(session_id, userId, guestToken);

    const result = await pool.query(
      `INSERT INTO questions (session_id, author_id, author_guest_token, body, status, post_anonymously, anon_number, author_display_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [session_id, userId, guestToken, cleanBody, initialStatus, postAnonymously, anonNumber, authorDisplayName],
    );

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
      `SELECT q.session_id, q.status AS current_status, s.host_id FROM questions q
       JOIN sessions s ON s.id = q.session_id WHERE q.id = $1`,
      [id],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');

    const { session_id, current_status } = qResult.rows[0];
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

    await pool.query(
      `UPDATE questions
       SET status = $1,
           is_spotlighted = CASE WHEN $1 = 'answered' THEN false ELSE is_spotlighted END,
           updated_at = NOW()
       WHERE id = $2`,
      [status, id],
    );

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
      'SELECT session_id, author_id, author_guest_token FROM questions WHERE id = $1',
      [questionId],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');

    const { session_id, author_id, author_guest_token } = qResult.rows[0];

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
        const spendResult = await client.query(
          `UPDATE session_participants
           SET credits_remaining = credits_remaining - 1, actions_used = actions_used + 1
           WHERE session_id = $1 AND ${col} = $2 AND credits_remaining > 0
           RETURNING credits_remaining`,
          [session_id, val],
        );
        if (spendResult.rowCount === 0) {
          await client.query('ROLLBACK');
          throw new AppError(402, 'No credits remaining');
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

    const updated = result.rows[0];
    const nowSpotlighted: boolean = updated.is_spotlighted;

    // session:spotlight tells all clients which question (or null) is now spotlighted
    broadcast(session_id, {
      type: 'session:spotlight',
      data: { question_id: nowSpotlighted ? id : null },
    });

    res.json(toPublicQuestion(updated));
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
 * Atomically deducts 1 credit. Throws 402 if user is out of credits.
 */
async function spendCredit(
  sessionId: string,
  userId: string | null,
  guestToken: string | null,
) {
  const col = userId ? 'user_id' : 'guest_token';
  const val = userId ?? guestToken;

  const result = await pool.query(
    `UPDATE session_participants
     SET credits_remaining = credits_remaining - 1,
         actions_used = actions_used + 1
     WHERE session_id = $1 AND ${col} = $2 AND credits_remaining > 0
     RETURNING credits_remaining`,
    [sessionId, val],
  );

  if (result.rowCount === 0) {
    throw new AppError(402, 'No credits remaining');
  }
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
