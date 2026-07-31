import { pool } from './pool';

/**
 * Resolved caller role for a given session.
 * Used by controllers to make permission decisions.
 */
export type CallerRole =
  | 'host'          // created the session
  | 'org_owner'     // owns the org that owns the session
  | 'org_admin'     // org admin (full mod rights on all org sessions)
  | 'moderator'     // explicitly added session moderator
  | 'participant'   // joined but no elevated rights
  | 'none';         // not a participant

export interface ModeratorPermissions {
  can_mark_answered: boolean;
  can_star: boolean;
  can_flag: boolean;
  can_hide: boolean;
}

/**
 * Returns the caller's role for a session and their explicit mod permissions
 * (if any). Org owners/admins get full permissions automatically.
 */
export async function resolveCallerRole(
  sessionId: string,
  callerId: string,
): Promise<{ role: CallerRole; permissions: ModeratorPermissions }> {
  const fullPerms: ModeratorPermissions = {
    can_mark_answered: true,
    can_star: true,
    can_flag: true,
    can_hide: true,
  };
  const noPerms: ModeratorPermissions = {
    can_mark_answered: false,
    can_star: false,
    can_flag: false,
    can_hide: false,
  };

  // Fetch session + org membership in one query
  const result = await pool.query(
    `SELECT
       s.host_id,
       s.org_id,
       om.role            AS org_role,
       sm.can_mark_answered,
       sm.can_star,
       sm.can_flag,
       sm.can_hide
     FROM sessions s
     LEFT JOIN organization_members om
            ON om.org_id = s.org_id AND om.user_id = $2
     LEFT JOIN session_moderators sm
            ON sm.session_id = s.id AND sm.user_id = $2
     WHERE s.id = $1`,
    [sessionId, callerId],
  );

  if (!result.rows[0]) return { role: 'none', permissions: noPerms };

  const row = result.rows[0];

  // Host
  if (row.host_id === callerId) return { role: 'host', permissions: fullPerms };

  // Org owner or admin — full rights on all sessions under the org
  if (row.org_role === 'owner') return { role: 'org_owner', permissions: fullPerms };
  if (row.org_role === 'admin') return { role: 'org_admin', permissions: fullPerms };

  // Explicit session moderator
  if (row.can_mark_answered !== null) {
    return {
      role: 'moderator',
      permissions: {
        can_mark_answered: row.can_mark_answered,
        can_star: row.can_star,
        can_flag: row.can_flag,
        can_hide: row.can_hide,
      },
    };
  }

  return { role: 'participant', permissions: noPerms };
}

/**
 * Convenience: throws 403 if caller is not host, org owner, or org admin.
 */
export async function requireHostOrOrgAdmin(sessionId: string, callerId: string) {
  const { role } = await resolveCallerRole(sessionId, callerId);
  if (role !== 'host' && role !== 'org_owner' && role !== 'org_admin') {
    const { AppError } = await import('../middleware/errorHandler');
    throw new AppError(403, 'Only the host or an org admin can do this');
  }
}
