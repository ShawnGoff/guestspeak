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

/**
 * The must-block cases are generated from the blocklist in the database rather
 * than written out here.
 *
 * Partly so this file is readable, and partly because a hardcoded copy drifts:
 * it tested whatever was true the day it was written, not what the filter is
 * actually configured with now. Generating them means every term in the live
 * list gets its evasions checked, including ones added through the admin panel
 * after this was last touched.
 *
 * The evasions are the ones the normaliser is built to defeat — case, leet
 * substitution, separators, and padding either side for substring terms.
 */
async function generateBlockCases(): Promise<string[]> {
  const { rows } = await pool.query<{ word: string; match_mode: string }>(
    'SELECT word, match_mode FROM banned_words WHERE blocks_handles = true',
  );
  if (!rows.length) {
    console.error('blocklist is empty — apply database/seeds/banned-words.sql first');
    process.exit(1);
  }

  const leet = (w: string) =>
    w.replace(/a/g, '4').replace(/e/g, '3').replace(/i/g, '1').replace(/o/g, '0').replace(/s/g, '5');

  const cases: string[] = [];
  for (const { word, match_mode } of rows) {
    cases.push(word, word.toUpperCase(), leet(word), word.split('').join('_'), word.split('').join('.'));
    // Only substring terms are expected to be caught inside a longer handle;
    // word-mode ones are documented in KNOWN_GAPS below as deliberately open.
    if (match_mode === 'substring') cases.push(`xX${word}Xx`, `${word}99`, `i_am_a_${word}`);
  }
  return [...new Set(cases)];
}

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
  const shouldBlock = await generateBlockCases();
  console.log(`MUST BLOCK — ${shouldBlock.length} cases generated from the live blocklist`);
  for (const h of shouldBlock) {
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
