import { normaliseHandle } from '../src/lib/wordFilter';
import { pool } from '../src/db/pool';

const SUBS: Record<string,string> = { a:'a@4', e:'e3', i:'i1!|', o:'o0', s:'s$5', t:'t7+', u:'uv', g:'g9', l:'l1' };
const SEP = '[\\s._\\-*]?';
function buildPattern(word: string): RegExp {
  const chars = word.toLowerCase().split('').map(c => {
    const sub = SUBS[c];
    const esc = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return sub ? `[${sub}]` : esc;
  });
  return new RegExp(`(?<![a-zA-Z0-9])${chars.join(SEP)}(?![a-zA-Z0-9])`, 'gi');
}

(async () => {
  const { rows } = await pool.query<{word:string;match_mode:string}>('SELECT word, match_mode FROM banned_words');
  const cases = ['PBOX_Morning','Hancock','Cockburn','Dickinson','shiitake_mushroom','peacock_tv','classic_rock','ren_takahashi','cocktail_hour'];
  for (const h of cases) {
    const flat = normaliseHandle(h);
    const proseHits = rows.filter(r => buildPattern(r.word).test(h)).map(r => `${r.word}[prose]`);
    const subHits = rows.filter(r => r.match_mode === 'substring' && flat.includes(normaliseHandle(r.word))).map(r => `${r.word}[sub]`);
    console.log(`${h.padEnd(20)} → ${flat.padEnd(18)} ${[...proseHits, ...subHits].join(', ') || '(nothing)'}`);
  }
  await pool.end();
})();
