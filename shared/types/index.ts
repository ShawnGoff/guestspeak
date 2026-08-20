// Shared TypeScript types used by both frontend and backend

export type UserRole = 'guest' | 'registered' | 'host' | 'moderator';
export type OrgRole = 'owner' | 'admin' | 'member';

export type SessionVisibility = 'public' | 'unlisted' | 'private';
export type CallerRole = 'host' | 'org_owner' | 'org_admin' | 'moderator' | 'participant' | 'none';
export type SessionStatus = 'upcoming' | 'live' | 'closed';
export type QuestionStatus = 'pending' | 'new' | 'starred' | 'answered' | 'hidden';
export type FlagReason = 'spam' | 'offensive' | 'harassment' | 'off_topic' | 'other';
export type SortOption = 'echoes' | 'recent' | 'answered' | 'starred';

export interface User {
  id: string;
  email?: string;
  username?: string;
  is_guest: boolean;
  created_at: string;
}

// ─── Organizations ───────────────────────────────────────────────────────────

export const ORG_CATEGORIES = [
  'Podcast',
  'Radio',
  'Conference',
  'Meetup',
  'Education',
  'Entertainment',
  'Sports',
  'News',
  'Music',
  'Technology',
  'Business',
  'Community',
] as const;

export type OrgCategory = typeof ORG_CATEGORIES[number];

export interface Organization {
  id: string;
  name: string;
  /** URL slug: guestspeak.app/org/:slug */
  slug: string;
  description?: string;
  avatar_url?: string;
  website?: string;
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
  categories: string[];
  is_verified?: boolean;
  follower_count?: number;
  created_at: string;
  updated_at: string;
}

export interface OrgSearchResult {
  id: string;
  name: string;
  slug: string;
  description?: string;
  avatar_url?: string;
  city?: string;
  region?: string;
  country?: string;
  categories: string[];
  member_count: number;
  distance_km?: number;
}

export interface OrganizationMember {
  id: string;
  org_id: string;
  user_id: string;
  username?: string;
  email?: string;
  role: OrgRole;
  joined_at: string;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  host_id: string;
  host_username: string;
  /** Set when session belongs to an org */
  org_id?: string;
  org_name?: string;
  org_slug?: string;
  /** Whether the signed-in caller already follows this session's channel. */
  org_is_following?: boolean;
  org_is_verified?: boolean;
  /** Populated in discover/list responses */
  participant_count?: number;
  distance_km?: number;
  title: string;
  description?: string;
  visibility: SessionVisibility;
  status: SessionStatus;
  slug: string;
  credits_per_user: number;
  // Location — all optional; used for Nearby discovery
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
  is_featured?: boolean;
  is_online?: boolean;
  stream_url?: string;
  join_code?: string;
  starts_at?: string;
  ends_at?: string;
  submission_cutoff_at?: string;
  requires_approval?: boolean;
  created_at: string;
  updated_at: string;
  caller_role?: CallerRole;
  /**
   * How the client should follow this session. 'live' opens an SSE stream;
   * 'polling' re-fetches the cached feed on an interval, used for sessions too
   * large for per-event fan-out. Hosts and moderators always receive 'live'.
   */
  feed_mode?: 'live' | 'polling';
  /** Interval the client should use when feed_mode is 'polling'. */
  poll_interval_ms?: number;
}

// ─── Questions ───────────────────────────────────────────────────────────────

export interface Question {
  id: string;
  session_id: string;
  author_id?: string;
  author_username?: string;
  /** Session participant row ID — present for hosts/mods to enable mute/ban */
  participant_id?: string;
  /** True if the question author is currently muted in this session */
  author_is_muted?: boolean;
  /** True when a registered user posted anonymously — shown as "Anon{n}" to everyone */
  post_anonymously?: boolean;
  /** Assigned anon number within the session (e.g. 3 → "Anon3") */
  anon_number?: number;
  body: string;
  status: QuestionStatus;
  /** Internal field — displayed publicly as "Echoes" */
  vote_count: number;
  /** Host-authored reply, shown in archived sessions */
  host_reply?: string;
  host_replied_at?: string;
  created_at: string;
  updated_at: string;
  /** Set only when the author corrected their own wording inside the edit window. */
  edited_at?: string | null;
}

// ─── Votes / Flags / Moderators ──────────────────────────────────────────────

export interface Vote {
  id: string;
  question_id: string;
  user_id?: string;
  guest_token?: string;
  created_at: string;
}

export interface Flag {
  id: string;
  question_id: string;
  user_id?: string;
  guest_token?: string;
  reason: FlagReason;
  is_moderator_flag: boolean;
  created_at: string;
}

export interface SessionModerator {
  id: string;
  session_id: string;
  user_id: string;
  can_mark_answered: boolean;
  can_star: boolean;
  can_flag: boolean;
  can_hide: boolean;
  can_mute: boolean;
  can_remove: boolean;
  can_approve: boolean;
  assigned_at: string;
}

export interface SessionParticipant {
  id: string;
  session_id: string;
  user_id?: string;
  guest_token?: string;
  joined_at: string;
  credits_remaining: number;
  actions_used: number;
}

// ─── User profiles ────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  username: string;
  created_at: string;
  follower_count: number;
  following_count: number;
  session_count: number;
  is_following?: boolean; // true if the caller follows this user
}

export interface UserSearchResult {
  id: string;
  username: string;
  session_count: number;
  follower_count: number;
  is_following: boolean;
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  user: User;
}

export interface GuestAuthResponse {
  token: string;
  guestToken: string;
}

export interface EchoResponse {
  vote_count: number;
}

export interface DiscoverResponse {
  live_now: Session[];
  featured: Session[];
  nearby: Session[];
  following: Session[];
}

export interface OrgDiscoverResponse {
  orgs: OrgSearchResult[];
}
