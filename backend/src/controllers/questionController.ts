import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errorHandler';
import { broadcast } from '../sse/broadcaster';
import { resolveCallerRole, requireHostOrOrgAdmin } from '../db/permissions';
import { filterText } from '../lib/wordFilter';
import { createNotificationsForUsers } from './notificationController';
import { fetchPublicQuestion, toPublicQuestion } from '../lib/questionHelpers';
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


export async function getQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = req.query.sessionId as string;
    const sort = (req.query.sort as SortOption) ?? 'echoes';
    const status = req.query.status as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    if (!sessionId) throw new AppError(400, 'sessionId is required');

    // Hosts/mods can see hidden questions; everyone else cannot
    const callerId = req.user?.isGuest === false ? req.user.userId : null;
    let includeHidden = false;
    if (callerId) {
      const { role } = await resolveCallerRole(sessionId, callerId);
      includeHidden = ['host', 'org_owner', 'org_admin', 'moderator'].includes(role);
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
              -- For anon posts: return "Anon{n}" as the display name; hide real identity from everyone
              CASE
                WHEN q.post_anonymously THEN 'Anon' || q.anon_number
                ELSE COALESCE(u.username, sp.guest_username)
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

    res.json({ data: result.rows, limit, offset });
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

    // Block non-hosts from submitting to private sessions
    if (visibility === 'private' && userId !== host_id) {
      throw new AppError(403, 'This session is private');
    }

    if (status === 'closed') throw new AppError(410, 'Session is closed');
    if (
      submission_cutoff_at &&
      new Date() > new Date(submission_cutoff_at)
    ) {
      throw new AppError(403, 'Question submission has closed for this session');
    }

    // Verify the user has joined (participant row must exist)
    await verifyParticipant(session_id, userId, guestToken);

    // Reject if the participant is muted or session-banned (pass IP for platform ban check)
    await rejectIfMutedOrBanned(session_id, userId, guestToken, req.ip ?? null);

    // Deduct 1 credit (atomic — prevents double-spend)
    await spendCredit(session_id, userId, guestToken);

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

    const result = await pool.query(
      `INSERT INTO questions (session_id, author_id, author_guest_token, body, status, post_anonymously, anon_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [session_id, userId, guestToken, cleanBody, initialStatus, postAnonymously, anonNumber],
    );

    const newId = result.rows[0].id;
    const publicQuestion = await fetchPublicQuestion(newId, session_id);

    // C4: only broadcast approved questions — pending ones wait for host approval
    if (initialStatus !== 'pending') {
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
      `SELECT q.session_id, s.host_id FROM questions q
       JOIN sessions s ON s.id = q.session_id WHERE q.id = $1`,
      [id],
    );
    if (!qResult.rows[0]) throw new AppError(404, 'Question not found');

    const { session_id } = qResult.rows[0];
    const { role, permissions } = await resolveCallerRole(session_id, callerId);

    if (role === 'participant' || role === 'none') {
      throw new AppError(403, 'Insufficient permissions');
    }

    // Hosts, org owners, and org admins have full rights.
    // Explicit moderators must have the specific permission.
    if (role === 'moderator') {
      const permCol = statusToPermColumn(status) as keyof typeof permissions;
      if (!permissions[permCol]) {
        throw new AppError(403, 'Insufficient permissions');
      }
    }

    await pool.query(
      `UPDATE questions SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id],
    );

    const publicQuestion = await fetchPublicQuestion(id, session_id);
    broadcast(session_id, { type: 'question:updated', data: publicQuestion });

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

    // Verify participant membership
    await verifyParticipant(session_id, userId, guestToken);

    // Reject muted, session-banned, or platform-banned users (pass IP for platform ban check)
    await rejectIfMutedOrBanned(session_id, userId, guestToken, req.ip ?? null);

    // Wrap credit spend + vote insert in a transaction.
    // Spend credit FIRST so a failed spend never lets the vote land.
    const col = userId ? 'user_id' : 'guest_token';
    const val = userId ?? guestToken;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Deduct credit — rolls back everything if user is out
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

    let isModeratorFlag = false;
    if (userId) {
      const modResult = await pool.query(
        `SELECT can_flag FROM session_moderators WHERE session_id = $1 AND user_id = $2`,
        [qResult.rows[0].session_id, userId],
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

  // Check mute
  const muteResult = await pool.query(
    `SELECT is_muted FROM session_participants WHERE session_id = $1 AND ${col} = $2`,
    [sessionId, val],
  );
  if (muteResult.rows[0]?.is_muted) {
    throw new AppError(403, 'You have been muted in this session');
  }

  // Check session ban
  const banResult = await pool.query(
    `SELECT id FROM session_bans WHERE session_id = $1 AND ${col} = $2`,
    [sessionId, val],
  );
  if (banResult.rows[0]) {
    throw new AppError(403, 'You have been removed from this session');
  }

  // Check platform ban — enforced on every action, not just at join.
  // Checks user_id, guest_token, AND IP so all three ban vectors are enforced.
  if (userId || guestToken || ipAddress) {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (userId) {
      params.push(userId);
      conditions.push(`user_id = $${params.length}`);
    }
    if (guestToken) {
      params.push(guestToken);
      conditions.push(`guest_token = $${params.length}`);
    }
    if (ipAddress) {
      params.push(ipAddress);
      conditions.push(`ip_address = $${params.length}`);
    }
    params.push(new Date().toISOString());
    const expiryCheck = `(expires_at IS NULL OR expires_at > $${params.length})`;

    const platformBan = await pool.query(
      `SELECT id FROM platform_bans WHERE (${conditions.join(' OR ')}) AND ${expiryCheck} LIMIT 1`,
      params,
    );
    if (platformBan.rows[0]) {
      throw new AppError(403, 'Your account has been suspended');
    }
  }
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

function statusToPermColumn(status: string): string {
  const map: Record<string, string> = {
    answered: 'can_mark_answered',
    starred: 'can_star',
    hidden: 'can_hide',
    flagged: 'can_flag',
  };
  return map[status] ?? 'can_hide';
}
