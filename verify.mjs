#!/usr/bin/env node
// Reads the generated .ics back and checks it, rather than trusting the builder.
// Run: node verify.mjs [year]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(HERE, 'wine-holidays.ics'), 'utf8');
const problems = [];

// --- structural checks ---
if (!raw.startsWith('BEGIN:VCALENDAR\r\n')) problems.push('does not start with BEGIN:VCALENDAR + CRLF');
if (!raw.endsWith('END:VCALENDAR\r\n')) problems.push('does not end with END:VCALENDAR + CRLF');
if (/(?<!\r)\n/.test(raw)) problems.push('contains a bare LF (every line must end CRLF)');

const rawLines = raw.split('\r\n').filter(Boolean);
for (const [i, line] of rawLines.entries()) {
  if (Buffer.from(line, 'utf8').length > 75) problems.push(`line ${i + 1} is over 75 octets: ${line.slice(0, 40)}...`);
}
const begins = rawLines.filter((l) => l === 'BEGIN:VEVENT').length;
const ends = rawLines.filter((l) => l === 'END:VEVENT').length;
if (begins !== ends) problems.push(`unbalanced VEVENT blocks: ${begins} BEGIN vs ${ends} END`);

// --- unfold, then parse ---
const lines = [];
for (const line of raw.split('\r\n')) {
  if (line.startsWith(' ')) lines[lines.length - 1] += line.slice(1);
  else if (line) lines.push(line);
}

const events = [];
let cur = null;
for (const line of lines) {
  if (line === 'BEGIN:VEVENT') cur = {};
  else if (line === 'END:VEVENT') { events.push(cur); cur = null; }
  else if (cur) {
    const idx = line.indexOf(':');
    const key = line.slice(0, idx).split(';')[0];
    cur[key] = line.slice(idx + 1);
  }
}

const uids = events.map((e) => e.UID);
if (new Set(uids).size !== uids.length) problems.push('duplicate UIDs found');

// --- independent RRULE expansion (yearly rules only, which is all we emit) ---
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);

function nthWeekday(year, month, weekday, n) {
  const target = WD[weekday];
  if (n === -1) {
    const last = new Date(Date.UTC(year, month, 0));
    return addDays(last, -((last.getUTCDay() - target + 7) % 7));
  }
  const first = new Date(Date.UTC(year, month - 1, 1));
  return addDays(first, ((target - first.getUTCDay() + 7) % 7) + (n - 1) * 7);
}

function expand(rrule, year) {
  const p = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')));
  if (p.FREQ !== 'YEARLY') throw new Error(`unexpected FREQ: ${p.FREQ}`);
  const month = Number(p.BYMONTH);
  if (p.BYMONTHDAY) return new Date(Date.UTC(year, month - 1, Number(p.BYMONTHDAY)));
  const m = p.BYDAY.match(/^(-?\d+)([A-Z]{2})$/);
  return nthWeekday(year, month, m[2], Number(m[1]));
}

const parseDate = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
const year = Number(process.argv[2]) || 2026;

// Critical check: for the anchor year, does the RRULE land on DTSTART?
let mismatches = 0;
for (const e of events) {
  if (!e.RRULE) continue;
  const start = parseDate(e.DTSTART);
  if (start.getUTCFullYear() !== 2026) continue;
  const expanded = expand(e.RRULE, 2026);
  if (iso(expanded) !== iso(start)) {
    problems.push(`RRULE/DTSTART disagree for "${e.SUMMARY}": DTSTART ${iso(start)} vs RRULE ${iso(expanded)}`);
    mismatches++;
  }
}

// --- print the requested year ---
const rows = [];
for (const e of events) {
  let start, days;
  if (e.RRULE) {
    start = expand(e.RRULE, year);
    days = Math.round((parseDate(e.DTEND) - parseDate(e.DTSTART)) / 86400000);
  } else {
    start = parseDate(e.DTSTART);
    if (start.getUTCFullYear() !== year) continue;
    days = Math.round((parseDate(e.DTEND) - start) / 86400000);
  }
  rows.push({ start, days, name: e.SUMMARY.replace(/\\([,;\\])/g, '$1'), kind: e.RRULE ? '' : ' [computed]' });
}
rows.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));

console.log(`\n=== Wine Holidays ${year} (${rows.length} entries) ===\n`);
for (const r of rows) {
  const span = r.days > 1 ? `  (${r.days} days, to ${iso(addDays(r.start, r.days - 1))})` : '';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][r.start.getUTCDay()];
  console.log(`${iso(r.start)} ${dow}  ${r.name}${span}${r.kind}`);
}

console.log(`\n--- checks ---`);
console.log(`${events.length} events parsed, ${mismatches} RRULE/DTSTART mismatches`);
if (problems.length) {
  console.log(`\nPROBLEMS (${problems.length}):`);
  for (const p of problems) console.log(`  ! ${p}`);
  process.exit(1);
}
console.log('all structural checks passed');
