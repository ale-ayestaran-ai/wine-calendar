#!/usr/bin/env node
// Turns wine-holidays.json into wine-holidays.ics.
// No dependencies. Run: node build.mjs
//
// Most entries become a single recurring event with an iCal RRULE, so the
// calendar app does the date math and the file never needs regenerating.
// The few rules RRULE can't express (e.g. "Thursday before Memorial Day")
// are written out as one event per year instead.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ANCHOR_YEAR = 2026;      // first year the recurring events start from
const EXPAND_YEARS = 25;       // how many years to write out for computed rules

const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// --- date helpers -----------------------------------------------------------
// All dates are handled in UTC so the local timezone can never shift a day.

const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (date, n) => new Date(date.getTime() + n * 86400000);

// nth weekday of a month. n = 1..5, or -1 for the last one.
function nthWeekday(year, month, weekday, n) {
  const target = WEEKDAYS[weekday];
  if (n === -1) {
    const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month
    return addDays(last, -((last.getUTCDay() - target + 7) % 7));
  }
  const first = utc(year, month, 1);
  const offset = (target - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (n - 1) * 7);
}

// Rules that RRULE cannot express, so we compute them year by year.
const COMPUTED = {
  // Memorial Day is the last Monday of May; the day is the Thursday before it.
  thursdayBeforeMemorialDay: (year) => ({
    start: addDays(nthWeekday(year, 5, 'MO', -1), -4),
    days: 1,
  }),
  // Labor Day is the first Monday of September; same idea.
  thursdayBeforeLaborDay: (year) => ({
    start: addDays(nthWeekday(year, 9, 'MO', 1), -4),
    days: 1,
  }),
  // Third Saturday of June through the last Sunday of June — length varies.
  englishWineWeek: (year) => {
    const start = nthWeekday(year, 6, 'SA', 3);
    const end = nthWeekday(year, 6, 'SU', -1);
    return { start, days: Math.round((end - start) / 86400000) + 1 };
  },
};

// --- ICS helpers ------------------------------------------------------------

const stamp = (date) =>
  date.getUTCFullYear().toString() +
  String(date.getUTCMonth() + 1).padStart(2, '0') +
  String(date.getUTCDate()).padStart(2, '0');

const escapeText = (s) =>
  String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 says lines wrap at 75 octets, continued with a leading space.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // don't split a multi-byte character across lines
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((start === 0 ? '' : ' ') + bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines lose one octet to the leading space
  }
  return out.join('\r\n');
}

function rrule(rule) {
  switch (rule.type) {
    case 'fixed':
      return `FREQ=YEARLY;BYMONTH=${rule.month};BYMONTHDAY=${rule.day}`;
    case 'month':
      return `FREQ=YEARLY;BYMONTH=${rule.month};BYMONTHDAY=1`;
    case 'nth_weekday':
      return `FREQ=YEARLY;BYMONTH=${rule.month};BYDAY=${rule.n}${rule.weekday}`;
    default:
      return null;
  }
}

// First occurrence of a recurring rule, and how many days it lasts.
function firstOccurrence(entry) {
  const { rule } = entry;
  if (rule.type === 'fixed') {
    return { start: utc(ANCHOR_YEAR, rule.month, rule.day), days: entry.durationDays ?? 1 };
  }
  if (rule.type === 'month') {
    const start = utc(ANCHOR_YEAR, rule.month, 1);
    const next = rule.month === 12 ? utc(ANCHOR_YEAR + 1, 1, 1) : utc(ANCHOR_YEAR, rule.month + 1, 1);
    return { start, days: Math.round((next - start) / 86400000) };
  }
  if (rule.type === 'nth_weekday') {
    return {
      start: nthWeekday(ANCHOR_YEAR, rule.month, rule.weekday, rule.n),
      days: entry.durationDays ?? 1,
    };
  }
  throw new Error(`unknown rule type: ${rule.type}`);
}

function describe(entry) {
  const parts = [entry.description];
  if (entry.region && entry.region !== 'International') parts.push(`Region: ${entry.region}`);
  if (entry.confidence === 'low') {
    parts.push('Heads up: sources disagree on this date — worth checking before you plan around it.');
  }
  if (entry.sources?.length) parts.push(`Source: ${entry.sources[0]}`);
  return parts.join('\n\n');
}

function vevent({ uid, start, days, summary, description, categories, dtstamp, recurrence }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${stamp(start)}`,
    `DTEND;VALUE=DATE:${stamp(addDays(start, days))}`,
  ];
  if (recurrence) lines.push(`RRULE:${recurrence}`);
  lines.push(
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `CATEGORIES:${escapeText(categories)}`,
    'TRANSP:TRANSPARENT',
    'END:VEVENT'
  );
  return lines.map(fold).join('\r\n');
}

// --- build ------------------------------------------------------------------

const data = JSON.parse(readFileSync(join(HERE, 'wine-holidays.json'), 'utf8'));
// Fixed DTSTAMP tied to the data file, so rebuilding without edits gives an
// identical file and git diffs stay clean.
const dtstamp = `${data._meta.updated.replace(/-/g, '')}T000000Z`;

const events = [];
let recurringCount = 0;
let expandedCount = 0;

for (const entry of data.holidays) {
  const common = {
    summary: entry.name,
    description: describe(entry),
    categories: entry.category,
    dtstamp,
  };

  if (entry.rule.type === 'computed') {
    const fn = COMPUTED[entry.rule.fn];
    if (!fn) throw new Error(`no computed function named ${entry.rule.fn}`);
    for (let y = ANCHOR_YEAR; y < ANCHOR_YEAR + EXPAND_YEARS; y++) {
      const { start, days } = fn(y);
      events.push({ start, ics: vevent({ ...common, uid: `${entry.slug}-${y}@wine-holidays`, start, days }) });
    }
    expandedCount++;
  } else {
    const { start, days } = firstOccurrence(entry);
    events.push({
      start,
      ics: vevent({ ...common, uid: `${entry.slug}@wine-holidays`, start, days, recurrence: rrule(entry.rule) }),
    });
    recurringCount++;
  }
}

events.sort((a, b) => a.start - b.start);

const calendar = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Wine Holidays//Wine Holidays Calendar//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  fold('X-WR-CALNAME:Wine Holidays'),
  fold(`X-WR-CALDESC:${escapeText('Grape days, wine weeks and wine-country traditions from around the world. ' + data.holidays.length + ' entries. Updated ' + data._meta.updated + '.')}`),
  'X-WR-TIMEZONE:UTC',
  'REFRESH-INTERVAL;VALUE=DURATION:P7D',
  'X-PUBLISHED-TTL:P7D',
  ...events.map((e) => e.ics),
  'END:VCALENDAR',
  '',
].join('\r\n');

writeFileSync(join(HERE, 'wine-holidays.ics'), calendar, 'utf8');

console.log(`Wrote wine-holidays.ics`);
console.log(`  ${data.holidays.length} holidays`);
console.log(`  ${recurringCount} as recurring rules, ${expandedCount} expanded over ${EXPAND_YEARS} years`);
console.log(`  ${events.length} events, ${calendar.split('\r\n').length} lines`);
