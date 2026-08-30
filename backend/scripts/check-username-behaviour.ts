import 'dotenv/config';
import { AppError } from '../src/middleware/errorHandler';

/** Mirrors the branch in checkUsername, so the two paths are testable. */
function classify(err: any): 'disallowed' | 'rethrow' {
  if (err?.statusCode === 400 || err?.status === 400) return 'disallowed';
  return 'rethrow';
}

const cases: [string, any, string][] = [
  ['a refused name (AppError 400)', new AppError(400, 'That name is not available.'), 'disallowed'],
  ['a missing column (pg error)',   Object.assign(new Error('column "match_mode" does not exist'), { code: '42703' }), 'rethrow'],
  ['a dropped connection',          Object.assign(new Error('connection terminated'), { code: 'ECONNRESET' }), 'rethrow'],
  ['some other AppError',           new AppError(500, 'boom'), 'rethrow'],
];
let bad = 0;
for (const [name, err, want] of cases) {
  const got = classify(err);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(32)} → ${got}`);
}
console.log(bad ? `\n${bad} failures` : '\nall correct');
process.exit(bad ? 1 : 0);
