import 'dotenv/config';
import { unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } from '../src/lib/unsubscribe';

const id = '758aeadc-fc56-4278-90c6-0977bce5cf09';
const t = unsubscribeToken(id);
const other = Buffer.from('11111111-1111-1111-1111-111111111111').toString('base64url');

const checks: [string, unknown, unknown][] = [
  ['round trip',            verifyUnsubscribeToken(t), id],
  ['tampered signature',    verifyUnsubscribeToken(t.slice(0, -2) + 'xy'), null],
  ['signature reused for another id', verifyUnsubscribeToken(`${other}.${t.split('.')[1]}`), null],
  ['garbage',               verifyUnsubscribeToken('nonsense'), null],
  ['empty',                 verifyUnsubscribeToken(''), null],
  ['stable across calls',   unsubscribeToken(id) === t, true],
];
let bad = 0;
for (const [name, got, want] of checks) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(34)} ${JSON.stringify(got)}`);
}
console.log(`\n  url: ${unsubscribeUrl(id)}`);
console.log(bad ? `\n${bad} failures` : '\nall correct');
process.exit(bad ? 1 : 0);
