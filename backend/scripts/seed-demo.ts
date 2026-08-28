/**
 * Fills a local database with enough channels, sessions and questions to see
 * what the product looks like busy.
 *
 * Discover, the dashboard and a channel page all read very differently with one
 * session on them than with thirty, and every layout judgement made against an
 * empty database is a guess. This makes the busy case reproducible.
 *
 * LOCAL ONLY. It refuses to run against anything that is not localhost, and
 * every account it creates shares one throwaway password. Run it against a real
 * database and you have put known credentials into production.
 *
 *   cd backend && npm run seed:demo          # add to whatever is there
 *   cd backend && npm run seed:demo -- --reset   # wipe first
 *
 * Everything it writes carries the seed marker in docs/ terms: accounts end in
 * `@seed.local`, which is what --reset keys off, so it never touches data you
 * created by hand.
 */

import bcrypt from 'bcrypt';
import { pool } from '../src/db/pool';

const PASSWORD = 'password123';
const EMAIL_DOMAIN = 'seed.local';

// ─── Guard ───────────────────────────────────────────────────────────────────

function assertLocal() {
  const url = process.env.DATABASE_URL ?? '';
  const local = /@?(localhost|127\.0\.0\.1)[:/]/.test(url) || url.startsWith('postgresql:///');
  if (!local) {
    console.error('[seed] DATABASE_URL is not local — refusing to run.');
    console.error('[seed] This creates accounts with a published password.');
    process.exit(1);
  }
}

// ─── Content ─────────────────────────────────────────────────────────────────

const CHANNELS = [
  { name: 'KGMZ Morning Drive', slug: 'kgmz-morning-drive', city: 'San Francisco', region: 'CA', country: 'US',
    categories: ['Radio', 'News'], desc: 'Weekday mornings, 6–10. Traffic, politics and whoever wanders into the studio.' },
  { name: 'The Midnight Hour', slug: 'the-midnight-hour', city: 'Austin', region: 'TX', country: 'US',
    categories: ['Podcast', 'Entertainment'], desc: 'Long-form interviews recorded after dark. No topic off limits.' },
  { name: 'StackConf', slug: 'stackconf', city: 'Berlin', region: null, country: 'DE',
    categories: ['Conference', 'Technology'], desc: 'The infrastructure conference. Three tracks, one very long hallway.' },
  { name: 'Civic Roundtable', slug: 'civic-roundtable', city: 'Portland', region: 'OR', country: 'US',
    categories: ['Community', 'News'], desc: 'Neighbours, council members and the occasional shouting match.' },
  { name: 'The Long Game', slug: 'the-long-game', city: 'Chicago', region: 'IL', country: 'US',
    categories: ['Sports'], desc: 'Post-match analysis that takes longer than the match.' },
  { name: 'Studio Notes', slug: 'studio-notes', city: null, region: null, country: null, online: true,
    categories: ['Music', 'Education'], desc: 'Producers pulling records apart, bar by bar. Online only.' },
];

const HOSTS = [
  'dana_ruiz', 'marcus_hale', 'priya_venkat', 'tomas_lindqvist', 'aisha_bello', 'ren_takahashi',
];

const AUDIENCE = [
  'jordan_p', 'sam_okafor', 'lena_v', 'chris_mbeki', 'nina_dalgaard', 'oscar_reyes',
  'wren_ashby', 'kofi_mensah', 'ilse_bakker', 'tavi_moreau', 'hana_sato', 'bex_carroll',
  'yusuf_kaya', 'margot_deene', 'ravi_shanmugam',
];

const GUEST_NAMES = [
  'JadeRhino14', 'BlueHeron92', 'SwiftOtter7', 'CalmFalcon33', 'RedMaple21', 'QuietBadger5',
];

/** Sessions, keyed to a channel index or null for a personal session. */
const SESSIONS: {
  org: number | null; host: number; title: string;
  status: 'live' | 'upcoming' | 'closed';
  visibility?: 'public' | 'unlisted' | 'private';
  hoursFromNow?: number; featured?: boolean;
}[] = [
  { org: 0, host: 0, title: 'Morning Drive open line — Thursday', status: 'live', featured: true },
  { org: 0, host: 0, title: 'On air: city transport commissioner', status: 'live' },
  { org: 0, host: 0, title: 'Friday listener callback', status: 'upcoming', hoursFromNow: 26 },
  { org: 0, host: 0, title: 'Tuesday open line', status: 'closed', hoursFromNow: -48 },

  { org: 1, host: 1, title: 'Episode 212 — the archivist who found the tapes', status: 'live', featured: true },
  { org: 1, host: 1, title: 'Episode 213 — recording live from the warehouse', status: 'upcoming', hoursFromNow: 72 },
  { org: 1, host: 1, title: 'Episode 211 — three hours on one photograph', status: 'closed', hoursFromNow: -168 },

  { org: 2, host: 2, title: 'Keynote: what we got wrong about queues', status: 'live', featured: true },
  { org: 2, host: 2, title: 'Track B — storage engines from scratch', status: 'live' },
  { org: 2, host: 2, title: 'Closing panel: the next ten years', status: 'upcoming', hoursFromNow: 6 },
  { org: 2, host: 2, title: 'Workshop — debugging what you did not write', status: 'upcoming', hoursFromNow: 30 },
  { org: 2, host: 2, title: 'Day one opening remarks', status: 'closed', hoursFromNow: -20 },

  { org: 3, host: 3, title: 'Zoning amendment 14 — public comment', status: 'live' },
  { org: 3, host: 3, title: 'Budget hearing, part two', status: 'upcoming', hoursFromNow: 50 },
  { org: 3, host: 3, title: 'Library funding — closed session notes', status: 'closed', hoursFromNow: -96 },

  { org: 4, host: 4, title: 'Derby post-match, everything on the table', status: 'live' },
  { org: 4, host: 4, title: 'Transfer window Q&A', status: 'upcoming', hoursFromNow: 14 },

  { org: 5, host: 5, title: 'Taking apart a 1971 rhythm section', status: 'live' },
  { org: 5, host: 5, title: 'Listener mixes, torn apart gently', status: 'upcoming', hoursFromNow: 96 },

  // Personal sessions, no channel — the other half of the product.
  { org: null, host: 1, title: 'Ask me anything about leaving academia', status: 'live' },
  { org: null, host: 3, title: 'Office hours — bring your worst bug', status: 'upcoming', hoursFromNow: 8 },
  { org: null, host: 4, title: 'Unlisted: internal team retro', status: 'live', visibility: 'unlisted' },
];

const QUESTIONS = [
  'How do you decide what makes the cut when you only have four minutes?',
  'Is there a plan for the stretch of road by the bridge, or is that permanent now?',
  'What changed your mind most in the last year?',
  'Can you talk about the part you cut from the final version?',
  'What is the question nobody asks you that you wish they would?',
  'How much of this is reproducible outside a lab?',
  'What would you do differently if you started over tomorrow?',
  'Who should we be listening to that we are not?',
  'Does the funding model actually work at this scale?',
  'What is the most common misconception about your field?',
  'How do you handle the days when none of it works?',
  'Is the tooling the bottleneck, or is it us?',
  'What did the first version look like?',
  'How do you know when something is finished?',
  'What are you reading that has nothing to do with your job?',
  'Where does the money actually go?',
  'What is the failure you learned the most from?',
  'How long before this is obsolete?',
  'What would change your mind about all of this?',
  'Is there a version of this that works for smaller teams?',
  'What do you wish you had been told at the start?',
  'How do you measure whether it is working?',
  'What is the least glamorous part of the job?',
  'Are we solving the right problem here?',
];

const REPLIES = [
  'Short answer: we do not know yet. Longer answer at the end of the show.',
  'This is the one I get most and I still do not have a clean answer.',
  'Good question — coming back to this after the break.',
  'We covered some of this last season but it deserves another pass.',
];

const PROMPTS = [
  'Who would you like to hear on the show next month?',
  'What should we cover that we keep skipping?',
  'Best thing you have heard this year — go.',
  'If you could ask the commissioner one question, what would it be?',
];

const PROMPT_REPLIES = [
  'The archivist from episode 212, but for a full three hours.',
  'More on the funding side. Everyone dances around it.',
  'Whoever runs the night desk. That is the real show.',
  'Something on how the sausage gets made, not just the sausage.',
  'Anyone who will disagree with you on air.',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length];
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);

async function reset() {
  console.log('[seed] --reset: removing previous seed data');
  // Keyed on the marker domain, so anything created by hand survives.
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE email LIKE $1`, [`%@${EMAIL_DOMAIN}`],
  );
  const ids = rows.map((r: { id: string }) => r.id);
  if (!ids.length) { console.log('[seed] nothing to remove'); return; }

  await pool.query(
    `DELETE FROM votes WHERE question_id IN (
       SELECT q.id FROM questions q JOIN sessions s ON s.id = q.session_id WHERE s.host_id = ANY($1))`, [ids]);
  await pool.query(`DELETE FROM questions WHERE session_id IN (SELECT id FROM sessions WHERE host_id = ANY($1))`, [ids]);
  await pool.query(`DELETE FROM session_participants WHERE session_id IN (SELECT id FROM sessions WHERE host_id = ANY($1))`, [ids]);
  await pool.query(`DELETE FROM session_participants WHERE user_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM session_moderators WHERE session_id IN (SELECT id FROM sessions WHERE host_id = ANY($1))`, [ids]);
  await pool.query(`DELETE FROM sessions WHERE host_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM channel_replies WHERE prompt_id IN (
       SELECT p.id FROM channel_prompts p JOIN organizations o ON o.id = p.org_id
        WHERE o.id IN (SELECT org_id FROM organization_members WHERE user_id = ANY($1)))`, [ids]);
  await pool.query(`DELETE FROM channel_prompts WHERE org_id IN (SELECT org_id FROM organization_members WHERE user_id = ANY($1))`, [ids]);
  await pool.query(`DELETE FROM org_followers WHERE user_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM org_followers WHERE org_id IN (SELECT org_id FROM organization_members WHERE user_id = ANY($1))`, [ids]);
  await pool.query(`DELETE FROM organizations WHERE id IN (SELECT org_id FROM organization_members WHERE user_id = ANY($1))`, [ids]);
  await pool.query(`DELETE FROM organization_members WHERE user_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
  console.log(`[seed] removed ${ids.length} seeded accounts and everything they owned`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  assertLocal();
  if (process.argv.includes('--reset')) await reset();

  const hash = await bcrypt.hash(PASSWORD, 10);

  // Accounts. Inserted directly rather than through /auth/register, which is
  // rate limited to ten per fifteen minutes and would refuse most of these.
  const mkUser = async (username: string) => {
    const { rows } = await pool.query(
      `INSERT INTO users (email, username, password_hash, is_guest)
       VALUES ($1, $2, $3, false)
       ON CONFLICT DO NOTHING RETURNING id`,
      [`${username}@${EMAIL_DOMAIN}`, username, hash],
    );
    if (rows[0]) return rows[0].id as string;
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    return existing.rows[0].id as string;
  };

  const hostIds = [];
  for (const u of HOSTS) hostIds.push(await mkUser(u));
  const audienceIds = [];
  for (const u of AUDIENCE) audienceIds.push(await mkUser(u));

  // A few guests, so bylines are not uniformly registered accounts.
  const guestIds: { id: string; token: string; name: string }[] = [];
  for (let i = 0; i < GUEST_NAMES.length; i++) {
    const token = `guest_seed_${i}_${Date.now()}`;
    const { rows } = await pool.query(
      `INSERT INTO users (is_guest) VALUES (true) RETURNING id`,
    );
    guestIds.push({ id: rows[0].id, token, name: GUEST_NAMES[i] });
  }
  console.log(`[seed] ${hostIds.length} hosts, ${audienceIds.length} audience, ${guestIds.length} guests`);

  // Channels.
  const orgIds: string[] = [];
  for (let i = 0; i < CHANNELS.length; i++) {
    const c = CHANNELS[i];
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, description, city, region, country, categories, is_online)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [c.name, `${c.slug}-seed`, c.desc, c.city, c.region, c.country, c.categories, !!(c as any).online],
    );
    const orgId = rows[0].id as string;
    orgIds.push(orgId);
    await pool.query(
      `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1,$2,'owner')`,
      [orgId, hostIds[i % hostIds.length]],
    );
    // Followers, varied so the counts are not all identical.
    const followers = audienceIds.slice(0, 3 + ((i * 4) % (audienceIds.length - 3)));
    for (const uid of followers) {
      await pool.query(
        `INSERT INTO org_followers (org_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [orgId, uid],
      );
    }
  }
  console.log(`[seed] ${orgIds.length} channels`);

  // Sessions.
  const sessionIds: { id: string; status: string }[] = [];
  for (let i = 0; i < SESSIONS.length; i++) {
    const s = SESSIONS[i];
    const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
      + '-' + Math.random().toString(36).slice(2, 8);
    const code = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, 'X');
    const startsAt = s.hoursFromNow !== undefined ? hoursAgo(-s.hoursFromNow) : null;

    const { rows } = await pool.query(
      `INSERT INTO sessions
         (host_id, org_id, title, slug, join_code, status, visibility, starts_at,
          credits_per_user, is_featured, went_live_at, ends_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        hostIds[s.host], s.org === null ? null : orgIds[s.org], s.title, slug, code,
        s.status, s.visibility ?? 'public', startsAt, 6, !!s.featured,
        s.status === 'live' ? hoursAgo(1) : null,
        s.status === 'closed' ? hoursAgo(Math.abs(s.hoursFromNow ?? 24)) : null,
        hoursAgo(24 + i * 3),
      ],
    );
    sessionIds.push({ id: rows[0].id, status: s.status });
  }
  console.log(`[seed] ${sessionIds.length} sessions`);

  // Participants, questions, echoes.
  let questionTotal = 0;
  let voteTotal = 0;

  for (let si = 0; si < sessionIds.length; si++) {
    const { id: sessionId, status } = sessionIds[si];

    // Bigger rooms for live sessions, so the numbers look like a live show.
    const audienceSize = status === 'live' ? 9 + (si % 6) : status === 'closed' ? 6 : 3 + (si % 4);
    const joiners = audienceIds.slice(0, Math.min(audienceSize, audienceIds.length));

    for (const uid of joiners) {
      await pool.query(
        `INSERT INTO session_participants (session_id, user_id, credits_remaining, joined_at, last_credit_at)
         VALUES ($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`,
        [sessionId, uid, 2 + (si % 5), hoursAgo(2)],
      );
    }
    // A couple of guests per live room.
    if (status === 'live') {
      for (const g of guestIds.slice(0, 2 + (si % 3))) {
        await pool.query(
          `INSERT INTO session_participants
             (session_id, guest_token, guest_username, credits_remaining, joined_at, last_credit_at)
           VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT DO NOTHING`,
          [sessionId, g.token, g.name, 3, hoursAgo(1)],
        );
      }
    }

    // Upcoming sessions get a light pre-show queue; live and closed get a feed.
    const count = status === 'live' ? 7 + (si % 6) : status === 'closed' ? 6 : 2 + (si % 3);

    for (let qi = 0; qi < count; qi++) {
      const asGuest = status === 'live' && qi % 4 === 3;
      const guest = guestIds[(si + qi) % guestIds.length];
      const author = audienceIds[(si * 3 + qi) % audienceIds.length];
      const anon = qi % 7 === 5;

      // Spread over the last two hours so "Recent" has a real order.
      const created = hoursAgo(2 - (qi / count) * 2 + Math.random() * 0.2);

      let qStatus = 'new';
      if (status === 'closed') qStatus = qi % 2 === 0 ? 'answered' : 'new';
      else if (qi === 0) qStatus = 'answered';
      else if (qi === 1) qStatus = 'starred';

      const { rows } = await pool.query(
        `INSERT INTO questions
           (session_id, author_id, author_guest_token, author_display_name, body, status,
            is_pinned, is_spotlighted, post_anonymously, anon_number, created_at, updated_at,
            host_reply, host_replied_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13) RETURNING id`,
        [
          sessionId,
          asGuest ? null : author,
          asGuest ? guest.token : null,
          asGuest ? guest.name : null,
          pick(QUESTIONS, si * 5 + qi),
          qStatus,
          qi === 2 && status === 'live',
          qi === 0 && status === 'live',
          anon && !asGuest,
          anon && !asGuest ? 1 + (qi % 3) : null,
          created,
          qStatus === 'answered' && qi % 3 === 0 ? pick(REPLIES, si + qi) : null,
          qStatus === 'answered' && qi % 3 === 0 ? created : null,
        ],
      );
      const questionId = rows[0].id as string;
      questionTotal++;

      // Echoes. The trigger keeps vote_count in step, so the feed sorts for real.
      // Weighted so a few questions clearly lead rather than everything tying.
      const weight = qi === 0 ? 1 : qi === 1 ? 0.8 : qi < 4 ? 0.5 : 0.25;
      const voters = audienceIds
        .filter(id => id !== author)
        .slice(0, Math.round(joiners.length * weight));
      for (const uid of voters) {
        await pool.query(
          `INSERT INTO votes (question_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [questionId, uid],
        );
        voteTotal++;
      }

      // A follow-up on the first answered question of each live session, so the
      // threaded case is visible somewhere.
      if (status === 'live' && qi === 0) {
        await pool.query(
          `INSERT INTO questions
             (session_id, author_id, body, status, parent_question_id, thread_root_id, created_at, updated_at)
           VALUES ($1,$2,$3,'new',$4,$4,$5,$5)`,
          [sessionId, author, 'Thanks — but what happens when that assumption does not hold?',
           questionId, new Date(created.getTime() + 300_000)],
        );
        questionTotal++;
      }
    }
  }
  console.log(`[seed] ${questionTotal} questions, ${voteTotal} echoes`);

  // Channel feed: prompts and replies.
  let promptTotal = 0;
  for (let i = 0; i < orgIds.length; i++) {
    const rounds = i % 3 === 0 ? 2 : 1;
    for (let r = 0; r < rounds; r++) {
      const { rows } = await pool.query(
        `INSERT INTO channel_prompts (org_id, author_id, body, created_at, closed_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [orgIds[i], hostIds[i % hostIds.length], pick(PROMPTS, i + r),
         hoursAgo(12 + r * 48), r === 1 ? hoursAgo(6) : null],
      );
      const promptId = rows[0].id as string;
      promptTotal++;
      for (let k = 0; k < 2 + ((i + r) % 4); k++) {
        await pool.query(
          `INSERT INTO channel_replies (prompt_id, author_id, body, status, created_at)
           VALUES ($1,$2,$3,'new',$4) ON CONFLICT DO NOTHING`,
          [promptId, audienceIds[(i * 3 + k) % audienceIds.length],
           pick(PROMPT_REPLIES, i + r + k), hoursAgo(10 - k)],
        );
      }
    }
  }
  console.log(`[seed] ${promptTotal} channel prompts with replies`);

  const counts = await pool.query(`
    SELECT 'channels' t, count(*)::int n FROM organizations
    UNION ALL SELECT 'sessions', count(*)::int FROM sessions
    UNION ALL SELECT '  live', count(*)::int FROM sessions WHERE status = 'live'
    UNION ALL SELECT '  upcoming', count(*)::int FROM sessions WHERE status = 'upcoming'
    UNION ALL SELECT '  closed', count(*)::int FROM sessions WHERE status = 'closed'
    UNION ALL SELECT 'questions', count(*)::int FROM questions
    UNION ALL SELECT 'echoes', count(*)::int FROM votes
    UNION ALL SELECT 'accounts', count(*)::int FROM users WHERE is_guest = false
    ORDER BY 1`);
  console.log('\n[seed] database now holds:');
  for (const r of counts.rows) console.log(`  ${String(r.t).padEnd(12)} ${r.n}`);
  console.log(`\n[seed] sign in as any of: ${HOSTS.join(', ')}`);
  console.log(`[seed] email is <username>@${EMAIL_DOMAIN}, password is ${PASSWORD}`);
}

main()
  .then(() => pool.end())
  .catch(async err => {
    console.error('[seed] failed:', err?.message ?? err);
    await pool.end().catch(() => {});
    process.exit(1);
  });
