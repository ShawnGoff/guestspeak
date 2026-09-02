/**
 * What the handle filter must and must not refuse.
 *
 *   npx tsx scripts/handle-filter-check.ts
 *
 * The MUST ALLOW list is the more valuable half. Refusing a real person's
 * username is a support ticket and an insult; letting one obscene handle
 * through is a moderation action. The list is mostly the Scunthorpe family —
 * ordinary words and surnames that contain something on the blocklist.
 */
import { rejectIfBannedHandle, normaliseHandle } from '../src/lib/wordFilter';
import { pool } from '../src/db/pool';

const SHOULD_BLOCK = [
  'nigger', 'xXniggerXx', 'nigger99', 'n1gger', 'n_i_g_g_e_r', 'NIGGER',
  'iamafaggot', 'f4ggot', 'faggot_lover', 'tranny4life', 'xxretardxx',
  'pornstar', 'analqueen', 'fuck', 'FUCK', 'f.u.c.k',
  'heilhitler', 'kkk88', 'whitepower1',
];
const SHOULD_ALLOW = [
  'dana_ruiz', 'PBOX_Morning', 'analysis_guy', 'DataAnalyst', 'scatterbrain',
  'raccoon_fan', 'spicy_takes', 'Scunthorpe_FC', 'Hancock', 'Cockburn',
  'assassin_creed', 'Dickinson', 'Essex_Radio', 'shiitake_mushroom',
  'peacock_tv', 'Penistone', 'classic_rock', 'grass_roots', 'JadeRhino14',
  'ren_takahashi', 'TheLongGame', 'cocktail_hour',
];

/**
 * Evasions the word-mode terms do not catch, and the reason we accept that.
 *
 * "cock" is word-mode so Hancock, Cockburn, Hitchcock, peacock and cocktail
 * survive; the cost is that "bigcock123" gets through. Promoting it to
 * substring flips which of those two failures you get, and the exception list
 * for -cock surnames alone has no natural end. Slurs take the opposite trade
 * on purpose: there, refusing an edge case beats publishing one.
 */
const KNOWN_GAPS = ['bigcock123', 'shitposter', 'dickhead99'];

(async () => {
  let fails = 0;
  console.log('MUST BLOCK');
  for (const h of SHOULD_BLOCK) {
    let blocked = false;
    try { await rejectIfBannedHandle(h); } catch { blocked = true; }
    if (!blocked) fails++;
    console.log(`  ${blocked ? 'ok  ' : 'MISS'}  ${h.padEnd(22)} → ${normaliseHandle(h)}`);
  }
  console.log('\nMUST ALLOW');
  for (const h of SHOULD_ALLOW) {
    let blocked = false;
    try { await rejectIfBannedHandle(h); } catch { blocked = true; }
    if (blocked) fails++;
    console.log(`  ${blocked ? 'FALSE POSITIVE' : 'ok  '}  ${h.padEnd(22)} → ${normaliseHandle(h)}`);
  }
  console.log('\nKNOWN GAPS — embedded word-mode terms, documented not fixed');
  for (const h of KNOWN_GAPS) {
    let blocked = false;
    try { await rejectIfBannedHandle(h); } catch { blocked = true; }
    console.log(`  ${blocked ? 'now caught' : 'still open'}  ${h}`);
  }

  console.log(fails ? `\n${fails} FAILURES` : '\nall correct');
  await pool.end();
  process.exit(fails ? 1 : 0);
})();
