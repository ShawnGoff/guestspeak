#!/usr/bin/env node
/**
 * audit-links.js — GuestSpeak navigation audit
 *
 * Scans every .tsx / .ts file in frontend/src and outputs a navigation map:
 *   • <Link href> destinations
 *   • router.push() calls
 *   • plain <a href> tags (flags internal ones that should use <Link>)
 *   • window.location.href assignments
 *
 * Flags suspicious patterns automatically:
 *   ⚠  Public / dashboard pages linking directly to /settings or /admin
 *   ⚠  Internal links using plain <a> instead of Next.js <Link>
 *   ⚠  Hardcoded absolute URLs that should probably be relative
 *   ⚠  Links to /api/ routes (almost certainly a bug)
 *
 * Usage:
 *   node ask-away/scripts/audit-links.js
 *
 * Output:
 *   Prints to stdout AND saves ask-away/scripts/audit-links-report.txt
 */

const fs   = require('fs');
const path = require('path');

const FRONTEND_SRC  = path.join(__dirname, '../frontend/src');
const REPORT_FILE   = path.join(__dirname, 'audit-links-report.txt');

// ─── Friendly route labels ────────────────────────────────────────────────────

const ROUTE_LABELS = {
  '/'                        : 'Landing',
  '/login'                   : 'Login',
  '/register'                : 'Register',
  '/forgot-password'         : 'Forgot password',
  '/reset-password'          : 'Reset password',
  '/dashboard'               : 'Dashboard',
  '/create'                  : 'Create session',
  '/discover'                : 'Discover',
  '/search'                  : 'Search',
  '/about'                   : 'About',
  '/contact'                 : 'Contact',
  '/privacy'                 : 'Privacy policy',
  '/terms'                   : 'Terms of service',
  '/cookies'                 : 'Cookie policy',
  '/settings'                : 'Account settings',
  '/admin'                   : 'Admin panel',
  '/sessions/mine'           : 'My sessions',
  '/demo'                    : 'Demo: discover',
  '/demo/session'            : 'Demo: session',
  '/demo/create'             : 'Demo: create',
  '/org/new'                 : 'New channel',
  '/org/[slug]'              : 'Channel public page',
  '/org/[slug]/settings'     : 'Channel settings',
  '/s/[slug]'                : 'Session page',
  '/s/[slug]/edit'           : 'Session edit',
  '/u/[username]'            : 'User profile',
};

// Pages that ARE privileged — linking to /settings or /admin from these is fine
const PRIVILEGED_ROUTES = new Set([
  '/org/[slug]/settings',
  '/s/[slug]/edit',
  '/settings',
  '/admin',
]);

// ─── File discovery ───────────────────────────────────────────────────────────

function walk(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ─── Derive route from file path ──────────────────────────────────────────────

function fileToRoute(filepath) {
  const rel = path.relative(FRONTEND_SRC, filepath);

  // Components and lib files — not a route
  if (rel.startsWith('components/') || rel.startsWith('lib/')) return null;

  let route = rel
    .replace(/^app/, '')
    .replace(/\/(page|layout|loading|error|not-found|opengraph-image)\.(tsx|ts)$/, '')
    .replace(/\.(tsx|ts)$/, '')
    || '/';

  return route || '/';
}

function routeLabel(route) {
  if (!route) return null;
  return ROUTE_LABELS[route] || null;
}

// ─── Link / navigation extraction ─────────────────────────────────────────────

function normalise(raw) {
  // Collapse template-literal interpolations to […] for readability
  return raw.replace(/\$\{[^}]+\}/g, '[…]');
}

function extractNavigation(content, filepath) {
  const found = [];

  // ── Next.js <Link href="..."> ──────────────────────────────────────────────

  // href="/static/path" or href='/static/path'
  for (const m of content.matchAll(/\bhref=["']([^"'\s]+)["']/g)) {
    found.push({ type: 'Link', dest: m[1], line: lineNum(content, m.index) });
  }

  // href={"/path"} or href={'/path'}
  for (const m of content.matchAll(/\bhref=\{["']([^"'\s]+)["']\}/g)) {
    found.push({ type: 'Link', dest: m[1], line: lineNum(content, m.index) });
  }

  // href={`/path/${var}/more`}  — template literal
  for (const m of content.matchAll(/\bhref=\{`([^`]+)`\}/g)) {
    found.push({ type: 'Link', dest: normalise(m[1]), line: lineNum(content, m.index) });
  }

  // ── router.push / router.replace ──────────────────────────────────────────

  for (const m of content.matchAll(/router\.(push|replace)\(\s*["'`]([^"'`\n]+)["'`]/g)) {
    found.push({ type: `router.${m[1]}`, dest: normalise(m[2]), line: lineNum(content, m.index) });
  }

  // router.push({ pathname: '/...' })
  for (const m of content.matchAll(/router\.(push|replace)\(\s*\{[^}]*pathname\s*:\s*["'`]([^"'`\n]+)["'`]/g)) {
    found.push({ type: `router.${m[1]}`, dest: normalise(m[2]), line: lineNum(content, m.index) });
  }

  // ── window.location ───────────────────────────────────────────────────────

  for (const m of content.matchAll(/window\.location\.(?:href|assign|replace)\s*=?\s*\(?\s*["'`]([^"'`\n]+)["'`]/g)) {
    found.push({ type: 'location', dest: normalise(m[1]), line: lineNum(content, m.index) });
  }

  // ── Plain <a href> ────────────────────────────────────────────────────────
  // Capture the element tag to distinguish <a> from <Link>
  for (const m of content.matchAll(/<a\b[^>]*\bhref=["'`]?([^"'`\s>]+)["'`]?/g)) {
    const dest = normalise(m[1]);
    found.push({ type: '<a>', dest, line: lineNum(content, m.index) });
  }

  // Deduplicate identical (type, dest) pairs per file
  const seen = new Set();
  return found.filter(({ type, dest }) => {
    const key = `${type}::${dest}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lineNum(content, index) {
  return content.slice(0, index).split('\n').length;
}

// ─── Suspicion checks ─────────────────────────────────────────────────────────

function flags(route, type, dest) {
  const issues = [];

  // Link to /api/* — almost certainly wrong in a frontend <Link>
  if (/^\/api\//.test(dest) && type !== 'location') {
    issues.push('⚠  Links to /api/ route — should this be a fetch call?');
  }

  // Internal path via plain <a> — should use Next.js <Link>
  if (type === '<a>' && /^\//.test(dest) && !dest.startsWith('//')) {
    issues.push('⚠  Internal path via <a> — use Next.js <Link> for client-side nav');
  }

  // Settings / admin link from a non-privileged page
  const settingsPattern = /\/(settings|admin)(\/|$|\?)/;
  if (settingsPattern.test(dest) && route && !PRIVILEGED_ROUTES.has(route)) {
    issues.push('⚠  Settings/admin link from public page — verify this is intentional');
  }

  // Hardcoded localhost in the codebase
  if (/https?:\/\/localhost/.test(dest)) {
    issues.push('⚠  Hardcoded localhost URL — remove before production');
  }

  return issues;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const W = 80;
const HR  = '─'.repeat(W);
const HR2 = '═'.repeat(W);

function padR(s, n) { return s.length >= n ? s : s + ' '.repeat(n - s.length); }

// ─── Main ─────────────────────────────────────────────────────────────────────

const files  = walk(FRONTEND_SRC).sort();
const lines  = [];
const allFlags = [];

lines.push(HR2);
lines.push('  GUESTSPEAK — NAVIGATION / LINK AUDIT');
lines.push(`  Generated : ${new Date().toLocaleString()}`);
lines.push(`  Files scanned: ${files.length}`);
lines.push(HR2);

// Group: app pages first, then components, then lib
const appFiles  = files.filter(f => f.includes('/app/'));
const compFiles = files.filter(f => f.includes('/components/'));
const libFiles  = files.filter(f => f.includes('/lib/'));

function processGroup(groupFiles, groupTitle) {
  const groupLines = [];
  let totalLinks = 0;

  for (const file of groupFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const navItems = extractNavigation(content, file);
    if (navItems.length === 0) continue;

    const rel   = path.relative(FRONTEND_SRC, file);
    const route = fileToRoute(file);
    const label = routeLabel(route);

    const header = label
      ? `${rel}   →   ${label}  (${route})`
      : `${rel}   →   ${route || '(component)'}`;

    groupLines.push('');
    groupLines.push(header);
    groupLines.push(HR);

    for (const { type, dest, line } of navItems) {
      const typeLabel = padR(type, 13);
      const lineLabel = `L${line}`.padStart(5);
      const itemFlags = flags(route, type, dest);

      groupLines.push(`  ${typeLabel}  ${lineLabel}   ${dest}`);
      for (const f of itemFlags) {
        groupLines.push(`               ${''.padStart(8)}   ${f}`);
        allFlags.push({ file: rel, type, dest, flag: f });
      }
      totalLinks++;
    }
  }

  if (groupLines.length === 0) return 0;

  lines.push('');
  lines.push(`  ── ${groupTitle} ──`);
  lines.push(...groupLines);
  return totalLinks;
}

const t1 = processGroup(appFiles,  'PAGES  (app/)');
const t2 = processGroup(compFiles, 'COMPONENTS  (components/)');
const t3 = processGroup(libFiles,  'LIB  (lib/)');

// ─── Flags summary ────────────────────────────────────────────────────────────

lines.push('');
lines.push(HR2);
lines.push('  FLAGGED ITEMS');
lines.push(HR2);

if (allFlags.length === 0) {
  lines.push('');
  lines.push('  ✓  No suspicious patterns detected.');
} else {
  for (const { file, type, dest, flag } of allFlags) {
    lines.push('');
    lines.push(`  ${flag}`);
    lines.push(`    File : ${file}`);
    lines.push(`    Type : ${type}`);
    lines.push(`    Dest : ${dest}`);
  }
}

lines.push('');
lines.push(HR2);
lines.push(`  SUMMARY   ${t1 + t2 + t3} total navigation items   ${allFlags.length} flagged`);
lines.push(HR2);

// ─── Output ───────────────────────────────────────────────────────────────────

const output = lines.join('\n');
console.log(output);
fs.writeFileSync(REPORT_FILE, output + '\n');
console.log(`\n  Report saved → ${REPORT_FILE}`);
