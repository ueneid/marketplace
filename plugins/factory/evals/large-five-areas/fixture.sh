#!/usr/bin/env bash
set -euo pipefail
# Large five-area Node.js fixture: famsched. 12 planted defects, each with a failing test.
mkdir -p src/calendar src/tasks src/inventory src/notify src/sync test/calendar test/tasks test/inventory test/notify test/sync

cat > package.json <<'__FIXTURE_EOF__'
{ "name": "famsched", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }
__FIXTURE_EOF__

cat > README.md <<'__FIXTURE_EOF__'
# famsched

A small family schedule library: shared calendar, chores, packing lists,
notifications and offline sync. Plain ESM, zero dependencies.

## Module map

- `src/calendar/` - events, recurrence rules and iCal (RFC 5545) export
- `src/tasks/` - chores, round-robin assignment and owner rotations
- `src/inventory/` - household items, checklists and packing lists
- `src/notify/` - quiet hours, daily digests and text formatting
- `src/sync/` - offline sync: Lamport clocks, record merge and conflict resolution

`src/index.js` re-exports every public function.

## Rules

- Each `src/<area>/` directory is one owner's; a change stays inside its area.
  No module imports from another area.
- Tests live in `test/<area>/` and mirror the source layout.

## Testing

Run `node --test` from the root. Node 20+ is enough; there is nothing to install.
__FIXTURE_EOF__

cat > src/index.js <<'__FIXTURE_EOF__'
// Public entry point. Every module's public functions are re-exported here,
// so exported names must stay unique across the whole library.
export * from './calendar/event.js';
export * from './calendar/recurrence.js';
export * from './calendar/ical.js';
export * from './tasks/task.js';
export * from './tasks/assign.js';
export * from './tasks/rotation.js';
export * from './inventory/items.js';
export * from './inventory/checklist.js';
export * from './inventory/packing.js';
export * from './notify/format.js';
export * from './notify/quiet.js';
export * from './notify/digest.js';
export * from './sync/clock.js';
export * from './sync/conflict.js';
export * from './sync/merge.js';
__FIXTURE_EOF__

cat > src/calendar/event.js <<'__FIXTURE_EOF__'
// Event model shared by recurrence expansion and iCal export.
// All dates are JavaScript Date objects and are treated as UTC.

const HOUR = 60 * 60 * 1000;

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

export function createEvent({ id, title, start, end, allDay = false, tags = [] }) {
  if (!id) throw new Error('event needs an id');
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new Error('event start must be a valid Date');
  }
  // A missing end means a one-hour slot, which is what the family app shows by default.
  const finish = end ?? new Date(start.getTime() + HOUR);
  if (finish < start) throw new Error('event ends before it starts');
  return { id, title: title ?? '', start, end: finish, allDay, tags: [...tags] };
}

export function durationMinutes(event) {
  return Math.round((event.end - event.start) / 60000);
}

// UTC date-time in iCal basic format, e.g. 20261224T180000Z.
export function stamp(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
__FIXTURE_EOF__

cat > src/calendar/ical.js <<'__FIXTURE_EOF__'
// iCalendar (RFC 5545) export of family events.
import { stamp } from './event.js';

const CRLF = '\r\n';

// TEXT values must escape backslash, semicolon, comma and newlines (RFC 5545 3.3.11).
export function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function eventLines(event) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.tags.length > 0) {
    lines.push(`CATEGORIES:${event.tags.map(escapeText).join(',')}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

export function toICal(events, { prodId = '-//famsched//EN' } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodId}`];
  for (const event of events) lines.push(...eventLines(event));
  lines.push('END:VCALENDAR');
  // Every content line, including the last one, ends with CRLF.
  return lines.join(CRLF) + CRLF;
}
__FIXTURE_EOF__

cat > src/calendar/recurrence.js <<'__FIXTURE_EOF__'
// Expands simple RRULE-like rules into concrete occurrence dates.
// Supported: FREQ=DAILY|WEEKLY, INTERVAL=n, BYDAY=MO,TU,... (weekly only).

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY);
}

export function parseRule(text) {
  const parts = Object.fromEntries(text.split(';').map((p) => p.split('=')));
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY') throw new Error(`unsupported FREQ: ${freq}`);
  const interval = parts.INTERVAL ? Number(parts.INTERVAL) : 1;
  const byDay = parts.BYDAY ? parts.BYDAY.split(',').map((d) => WEEKDAYS.indexOf(d)) : null;
  if (byDay && byDay.includes(-1)) throw new Error(`bad BYDAY: ${parts.BYDAY}`);
  return { freq, interval, byDay };
}

// Returns every occurrence between `from` and `until`, both inclusive.
// Occurrences keep the time of day of `from`.
export function expand(rule, from, until) {
  const out = [];
  const step = rule.interval ?? 1;
  if (rule.freq === 'DAILY') {
    for (let d = from; d <= until; d = addDays(d, step)) out.push(d);
    return out;
  }
  // Weekly: walk day by day so BYDAY can pick several weekdays in one week.
  const days = rule.byDay ?? [from.getUTCDay()];
  const end = addDays(until, 1); // include the whole `until` day
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const week = Math.floor((d - from) / (7 * DAY));
    if (week % step !== 0) continue;
    if (days.includes(d.getUTCDay())) out.push(d);
  }
  return out;
}
__FIXTURE_EOF__

cat > src/inventory/checklist.js <<'__FIXTURE_EOF__'
// Checklists say what is needed, e.g. "beach trip: towel x4, sunscreen x1".
import { indexByName, normalizeName } from './items.js';

export function createChecklist(name, entries) {
  for (const e of entries) {
    if (!Number.isInteger(e.qty) || e.qty < 1) throw new Error(`bad qty for ${e.name}`);
  }
  return { name, entries: entries.map((e) => ({ name: e.name, qty: e.qty })) };
}

// What is still missing: [{ name, short }] where `short` is how many more are needed.
export function missing(checklist, items) {
  const have = indexByName(items);
  return checklist.entries
    .filter((e) => !have.has(normalizeName(e.name)))
    .map((e) => ({ name: e.name, short: e.qty }));
}

export function isReady(checklist, items) {
  return missing(checklist, items).length === 0;
}

// Merges two checklists; for the same item the larger quantity wins.
export function combine(a, b) {
  const byName = new Map();
  for (const e of [...a.entries, ...b.entries]) {
    const key = normalizeName(e.name);
    const prev = byName.get(key);
    if (!prev || e.qty > prev.qty) byName.set(key, e);
  }
  return createChecklist(`${a.name} + ${b.name}`, [...byName.values()]);
}
__FIXTURE_EOF__

cat > src/inventory/items.js <<'__FIXTURE_EOF__'
// Household items: what the family owns and how many.

// Names are typed by hand on phones, so " Socks" and "socks" must match.
export function normalizeName(name) {
  return String(name).trim().toLowerCase();
}

export function createItem({ name, qty = 1, tags = [] }) {
  if (!normalizeName(name)) throw new Error('item needs a name');
  if (!Number.isInteger(qty) || qty < 0) throw new Error('qty must be a non-negative integer');
  return { name: name.trim(), qty, tags: tags.map(normalizeName) };
}

// Map of normalized name -> total quantity. Duplicate rows are added up,
// because two people may each have logged "towel".
export function indexByName(items) {
  const index = new Map();
  for (const item of items) {
    const key = normalizeName(item.name);
    index.set(key, (index.get(key) ?? 0) + item.qty);
  }
  return index;
}

export function hasTag(item, tag) {
  return item.tags.includes(normalizeName(tag));
}
__FIXTURE_EOF__

cat > src/inventory/packing.js <<'__FIXTURE_EOF__'
// Packing for an event: what to bring and what is still missing.
import { hasTag } from './items.js';
import { missing } from './checklist.js';

export function byTag(items, tag) {
  return items.filter((item) => hasTag(item, tag));
}

// Summary shown on the event card before leaving.
export function packingList(event, checklist, items) {
  const short = missing(checklist, items);
  return {
    event: event.id,
    ready: short.length === 0,
    missing: short,
  };
}

// Counts items per tag, used for the tag filter chips.
export function tagCounts(items) {
  const counts = new Map();
  for (const item of items) {
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}
__FIXTURE_EOF__

cat > src/notify/digest.js <<'__FIXTURE_EOF__'
// The morning digest: today's and upcoming events, grouped per day.
import { isoDay, eventLine } from './format.js';

// Groups events by calendar day. `tz` is the family's fixed UTC offset in
// minutes (540 for JST), so the grouping matches the wall clock at home.
// Returns a plain object { "YYYY-MM-DD": [events sorted by start] } with days in order.
export function groupByDay(events, tz = 0) {
  const groups = new Map();
  for (const event of events) {
    const key = isoDay(event.start);
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  const days = [...groups.keys()].sort();
  return Object.fromEntries(days.map((d) => [d, groups.get(d).sort((a, b) => a.start - b.start)]));
}

export function renderDigest(events, tz = 0) {
  const groups = groupByDay(events, tz);
  const parts = [];
  for (const [day, list] of Object.entries(groups)) {
    parts.push(day);
    for (const event of list) parts.push(`  ${eventLine(event, tz)}`);
  }
  return parts.join('\n');
}

export function countByDay(events, tz = 0) {
  return Object.fromEntries(Object.entries(groupByDay(events, tz)).map(([d, l]) => [d, l.length]));
}
__FIXTURE_EOF__

cat > src/notify/format.js <<'__FIXTURE_EOF__'
// Text helpers for notifications. Times of day are minutes since midnight.

function pad2(n) {
  return String(n).padStart(2, '0');
}

// "07:30" -> 450
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error(`bad time: ${text}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

// 450 -> "07:30"
export function formatClock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

// UTC calendar day of a Date, "YYYY-MM-DD".
export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

// One digest line, "09:30 Swim class". `tz` is a fixed UTC offset in minutes.
export function eventLine(event, tz = 0) {
  const local = new Date(event.start.getTime() + tz * 60000);
  return `${formatClock(local.getUTCHours() * 60 + local.getUTCMinutes())} ${event.title}`;
}
__FIXTURE_EOF__

cat > src/notify/quiet.js <<'__FIXTURE_EOF__'
// Quiet hours: no pings while the family sleeps.
import { parseClock, formatClock } from './format.js';

// A window is { start: "HH:MM", end: "HH:MM" }; start is inclusive, end exclusive.
export function parseWindow(window) {
  return { start: parseClock(window.start), end: parseClock(window.end) };
}

// `time` is "HH:MM".
export function isQuiet(time, window) {
  const t = parseClock(time);
  const { start, end } = parseWindow(window);
  return t >= start && t < end;
}

// When a notification raised at `time` may actually be delivered.
export function deliveryTime(time, window) {
  if (!isQuiet(time, window)) return time;
  return formatClock(parseWindow(window).end);
}

// Length of the quiet window in minutes, for the settings screen.
export function quietMinutes(window) {
  const { start, end } = parseWindow(window);
  return (end - start + 1440) % 1440;
}
__FIXTURE_EOF__

cat > src/sync/clock.js <<'__FIXTURE_EOF__'
// Lamport clocks: every device counts its own edits, and jumps ahead when it
// sees a newer edit from another device. Wall clocks on phones cannot be trusted.

export function createClock(deviceId, time = 0) {
  if (!deviceId) throw new Error('clock needs a device id');
  return { deviceId, time };
}

// Called before a local edit; the new time is stamped on the record.
export function tick(clock) {
  return { ...clock, time: clock.time + 1 };
}

// Called when a remote record arrives.
export function observe(clock, remoteTime) {
  return { ...clock, time: Math.max(clock.time, remoteTime) + 1 };
}

// Orders two record clocks: negative if a is older.
export function compareClocks(a, b) {
  return a - b;
}

export function highestClock(records) {
  return records.reduce((max, r) => Math.max(max, r.clock), 0);
}
__FIXTURE_EOF__

cat > src/sync/conflict.js <<'__FIXTURE_EOF__'
// Picks the winning version when two devices edited the same record.
// A version is { key, value, clock, id, deleted? }: `key` names the record,
// `id` is the device that wrote this version. Two versions of one key can
// therefore carry different ids, and the id breaks clock ties.
import { compareClocks } from './clock.js';

// Every device must pick the same winner, or the family's phones drift apart.
export function resolve(a, b) {
  const byClock = compareClocks(a.clock, b.clock);
  if (byClock !== 0) return byClock > 0 ? a : b;
  return a.id > b.id ? a : b;
}

// A real conflict: same clock, different content.
export function isConflict(a, b) {
  return (
    a.clock === b.clock &&
    (a.value !== b.value || Boolean(a.deleted) !== Boolean(b.deleted))
  );
}

// Human-readable note for the sync log.
export function describe(a, b) {
  const winner = resolve(a, b);
  const loser = winner === a ? b : a;
  return `${winner.key}: kept ${winner.id}@${winner.clock}, dropped ${loser.id}@${loser.clock}`;
}
__FIXTURE_EOF__

cat > src/sync/merge.js <<'__FIXTURE_EOF__'
// Merges the local replica with one pulled from the server.
// Deletions are kept as tombstones ({ deleted: true }) so they can travel
// to other devices; `live` hides them from the UI.
import { observe, highestClock } from './clock.js';
import { resolve } from './conflict.js';

const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function merge(local, remote) {
  const out = new Map();
  for (const record of local) {
    if (!record.deleted) out.set(record.key, record);
  }
  for (const record of remote) {
    const mine = out.get(record.key);
    out.set(record.key, mine ? resolve(mine, record) : record);
  }
  return [...out.values()].sort(byKey);
}

export function live(records) {
  return records.filter((r) => !r.deleted);
}

// After a merge the device clock must move past everything it has seen.
export function advanceClock(clock, records) {
  return observe(clock, highestClock(records));
}
__FIXTURE_EOF__

cat > src/tasks/assign.js <<'__FIXTURE_EOF__'
// Spreads open chores over family members.
import { isOpen, totalPoints } from './task.js';

// Members look like { id, name, away? }. Returns a Map of taskId -> memberId.
// Done tasks are not assigned again.
export function roundRobin(tasks, members) {
  if (members.length === 0) throw new Error('nobody to assign to');
  const result = new Map();
  let i = 0;
  for (const task of tasks) {
    if (!isOpen(task)) continue;
    const member = members[i % members.length];
    result.set(task.id, member.id);
    i += 1;
  }
  return result;
}

// Sums the points each member got, so the app can show who is carrying the load.
export function loadByMember(assignments, tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const load = new Map();
  for (const [taskId, memberId] of assignments) {
    const mine = load.get(memberId) ?? [];
    mine.push(byId.get(taskId));
    load.set(memberId, mine);
  }
  return new Map([...load].map(([memberId, list]) => [memberId, totalPoints(list)]));
}
__FIXTURE_EOF__

cat > src/tasks/rotation.js <<'__FIXTURE_EOF__'
// Fixed rotations, e.g. "who takes out the trash this week".

export function createRotation(name, memberIds) {
  if (memberIds.length === 0) throw new Error('rotation needs at least one member');
  if (new Set(memberIds).size !== memberIds.length) throw new Error('duplicate member in rotation');
  return { name, members: [...memberIds] };
}

// The owner after `lastOwner`. An unknown or missing lastOwner starts from the top.
export function nextOwner(rotation, lastOwner) {
  const idx = rotation.members.indexOf(lastOwner);
  if (idx === -1) return rotation.members[0];
  return rotation.members[idx + 1];
}

// The next `count` owners, starting with `first`.
export function schedule(rotation, first, count) {
  const out = [];
  let owner = first;
  for (let i = 0; i < count; i += 1) {
    out.push(owner);
    owner = nextOwner(rotation, owner);
  }
  return out;
}

export function rename(rotation, name) {
  return { ...rotation, name };
}
__FIXTURE_EOF__

cat > src/tasks/task.js <<'__FIXTURE_EOF__'
// Household chores. `due` is a Date; `points` weighs how much effort a chore takes.

export function createTask({ id, title, due = null, points = 1, done = false }) {
  if (!id) throw new Error('task needs an id');
  if (!Number.isInteger(points) || points < 1) throw new Error('points must be a positive integer');
  return { id, title: title ?? '', due, points, done, doneAt: null };
}

export function isOpen(task) {
  return !task.done;
}

// Returns a new task; tasks are treated as immutable so sync can diff them.
export function complete(task, at = new Date()) {
  if (task.done) return task;
  return { ...task, done: true, doneAt: at };
}

export function overdue(tasks, now) {
  return tasks.filter((t) => isOpen(t) && t.due !== null && t.due < now);
}

export function totalPoints(tasks) {
  return tasks.reduce((sum, t) => sum + t.points, 0);
}
__FIXTURE_EOF__

cat > test/calendar/ical.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as event from '../../src/calendar/event.js';
import * as ical from '../../src/calendar/ical.js';

const start = new Date('2026-12-24T18:00:00Z');

test('createEvent defaults to a one-hour slot', () => {
  const e = event.createEvent({ id: 'e1', title: 'Dinner', start });
  assert.equal(event.durationMinutes(e), 60);
  assert.throws(() => event.createEvent({ title: 'no id', start }), /needs an id/);
});

test('stamp writes UTC basic date-time', () => {
  assert.equal(event.stamp(start), '20261224T180000Z');
});

test('escapeText escapes iCal special characters', () => {
  assert.equal(ical.escapeText('a,b;c\\d\ne'), 'a\\,b\;c\\\\d\\ne');
});

test('toICal writes a VCALENDAR with one VEVENT per event', () => {
  const e = event.createEvent({ id: 'e1', title: 'Dinner', start, tags: ['family'] });
  const out = ical.toICal([e]);
  assert.ok(out.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(out.endsWith('END:VCALENDAR\r\n'));
  assert.match(out, /\r\nDTSTART:20261224T180000Z\r\n/);
  assert.match(out, /\r\nCATEGORIES:family\r\n/);
});

test('toICal folds content lines longer than 75 octets (RFC 5545 3.1)', () => {
  // The Japanese part makes octets differ from characters: fold by bytes, never inside a character.
  const title = 'Grandma visit '.repeat(8) + 'おばあちゃんが来る日'.repeat(4);
  const out = ical.toICal([event.createEvent({ id: 'e2', title, start })]);
  for (const physical of out.split('\r\n')) {
    assert.ok(Buffer.byteLength(physical) <= 75, `line is ${Buffer.byteLength(physical)} octets: ${physical}`);
  }
  const unfolded = out.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(`SUMMARY:${title}\r\n`), 'unfolding must give back the original line');
});

test('foldLine is exported and leaves short lines alone', () => {
  assert.equal(typeof ical.foldLine, 'function', 'ical.js must export foldLine');
  assert.equal(ical.foldLine('SUMMARY:short'), 'SUMMARY:short');
  assert.equal(ical.foldLine('X:' + 'a'.repeat(80)), 'X:' + 'a'.repeat(73) + '\r\n ' + 'a'.repeat(7));
});

test('all-day events use DTSTART;VALUE=DATE with no time part', () => {
  assert.equal(typeof event.dateStamp, 'function', 'event.js must export dateStamp');
  assert.equal(event.dateStamp(start), '20261224');
  const e = event.createEvent({
    id: 'e3',
    title: 'Christmas Eve',
    start: new Date('2026-12-24T00:00:00Z'),
    end: new Date('2026-12-25T00:00:00Z'),
    allDay: true,
  });
  const out = ical.toICal([e]);
  assert.match(out, /\r\nDTSTART;VALUE=DATE:20261224\r\n/, 'all-day DTSTART must be a DATE value');
  assert.doesNotMatch(out, /DTSTART:2026/, 'all-day events must not carry a date-time DTSTART');
});
__FIXTURE_EOF__

cat > test/calendar/recurrence.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as recurrence from '../../src/calendar/recurrence.js';

const day = (s) => new Date(`${s}T09:00:00Z`);
const iso = (dates) => dates.map((d) => d.toISOString().slice(0, 10));

test('parseRule reads FREQ, INTERVAL and BYDAY', () => {
  assert.deepEqual(recurrence.parseRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR'), {
    freq: 'WEEKLY',
    interval: 2,
    byDay: [1, 5],
  });
});

test('parseRule rejects unsupported frequencies', () => {
  assert.throws(() => recurrence.parseRule('FREQ=YEARLY'), /unsupported FREQ/);
});

test('daily expand includes both ends of the range', () => {
  const rule = recurrence.parseRule('FREQ=DAILY');
  assert.deepEqual(iso(recurrence.expand(rule, day('2026-11-02'), day('2026-11-04'))), [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
  ]);
});

test('weekly expand never returns an occurrence after `until`', () => {
  // Mondays and Tuesdays from Mon 2 Nov to Mon 16 Nov. Tue 17 Nov is past `until`
  // and must not appear.
  const rule = recurrence.parseRule('FREQ=WEEKLY;BYDAY=MO,TU');
  const until = day('2026-11-16');
  const got = recurrence.expand(rule, day('2026-11-02'), until);
  assert.deepEqual(
    iso(got),
    ['2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10', '2026-11-16'],
    'weekly occurrences must stop at `until` (inclusive), not one day later',
  );
  for (const d of got) assert.ok(d <= until, `${d.toISOString()} is after until`);
});
__FIXTURE_EOF__

cat > test/inventory/checklist.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as items from '../../src/inventory/items.js';
import * as checklist from '../../src/inventory/checklist.js';

test('items are matched by normalized name and duplicate rows add up', () => {
  const list = [items.createItem({ name: ' Towel ', qty: 2 }), items.createItem({ name: 'towel', qty: 1 })];
  assert.equal(items.normalizeName('  SoCks '), 'socks');
  assert.deepEqual([...items.indexByName(list)], [['towel', 3]]);
  assert.throws(() => items.createItem({ name: ' ' }), /needs a name/);
});

test('missing reports items that are absent entirely', () => {
  const c = checklist.createChecklist('beach', [{ name: 'towel', qty: 1 }, { name: 'sunscreen', qty: 2 }]);
  const have = [items.createItem({ name: 'Towel' })];
  assert.deepEqual(checklist.missing(c, have), [{ name: 'sunscreen', short: 2 }]);
  assert.equal(checklist.isReady(c, have), false);
  assert.equal(checklist.isReady(c, [...have, items.createItem({ name: 'sunscreen', qty: 2 })]), true);
});

test('missing compares quantities and reports the shortfall', () => {
  const c = checklist.createChecklist('ski', [{ name: 'socks', qty: 4 }, { name: 'gloves', qty: 2 }]);
  const have = [items.createItem({ name: 'socks', qty: 2 }), items.createItem({ name: 'gloves', qty: 2 })];
  assert.deepEqual(
    checklist.missing(c, have),
    [{ name: 'socks', short: 2 }],
    'need 4 socks and have 2, so 2 are short; gloves are complete',
  );
});

test('combine keeps the larger quantity per item', () => {
  const a = checklist.createChecklist('a', [{ name: 'towel', qty: 2 }]);
  const b = checklist.createChecklist('b', [{ name: 'Towel', qty: 4 }, { name: 'hat', qty: 1 }]);
  assert.deepEqual(checklist.combine(a, b).entries, [{ name: 'Towel', qty: 4 }, { name: 'hat', qty: 1 }]);
});
__FIXTURE_EOF__

cat > test/inventory/packing.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as packing from '../../src/inventory/packing.js';
import { createItem } from '../../src/inventory/items.js';
import { createChecklist } from '../../src/inventory/checklist.js';

const stock = [
  createItem({ name: 'Swimsuit', tags: ['beach', 'pool'] }),
  createItem({ name: 'Sunscreen', tags: ['Beach'] }),
  createItem({ name: 'Ski gloves', qty: 2, tags: ['snow'] }),
  createItem({ name: 'Book' }),
];

test('byTag and tagCounts use normalized tags', () => {
  assert.deepEqual(packing.byTag(stock, 'BEACH').map((i) => i.name), ['Swimsuit', 'Sunscreen']);
  assert.deepEqual([...packing.tagCounts(stock)], [['beach', 2], ['pool', 1], ['snow', 1]]);
});

test('packingList says whether the event is ready', () => {
  const c = createChecklist('trip', [{ name: 'swimsuit', qty: 1 }, { name: 'towel', qty: 1 }]);
  assert.deepEqual(packing.packingList({ id: 'ev1' }, c, stock), {
    event: 'ev1',
    ready: false,
    missing: [{ name: 'towel', short: 1 }],
  });
});

test('suggest returns items sharing a tag with the event, sorted by name', () => {
  assert.equal(typeof packing.suggest, 'function', 'packing.js must export suggest(event, items)');
  const event = { id: 'ev2', tags: ['pool', 'beach'] };
  assert.deepEqual(
    packing.suggest(event, stock).map((i) => i.name),
    ['Sunscreen', 'Swimsuit'],
    'each matching item once, sorted by name; untagged and snow items are left out',
  );
});
__FIXTURE_EOF__

cat > test/notify/digest.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as digest from '../../src/notify/digest.js';
import * as format from '../../src/notify/format.js';

const ev = (title, iso) => ({ title, start: new Date(iso) });

test('groupByDay in UTC sorts days and events', () => {
  const events = [ev('Swim', '2026-11-03T09:00:00Z'), ev('Piano', '2026-11-02T17:00:00Z'), ev('School', '2026-11-02T08:00:00Z')];
  const groups = digest.groupByDay(events, 0);
  assert.deepEqual(Object.keys(groups), ['2026-11-02', '2026-11-03']);
  assert.deepEqual(groups['2026-11-02'].map((e) => e.title), ['School', 'Piano']);
  assert.deepEqual(digest.countByDay(events, 0), { '2026-11-02': 2, '2026-11-03': 1 });
});

test('renderDigest prints a day header and indented lines', () => {
  const events = [ev('School', '2026-11-02T08:00:00Z')];
  assert.equal(digest.renderDigest(events, 0), '2026-11-02\n  08:00 School');
  assert.equal(format.isoDay(new Date('2026-11-02T23:59:00Z')), '2026-11-02');
  assert.equal(format.eventLine(events[0], 540), '17:00 School');
});

test('groupByDay uses the local date for the given UTC offset', () => {
  // With tz = 540 (JST), 14:00Z is 23:00 on 2 Nov but 16:00Z is 01:00 on 3 Nov.
  const events = [ev('Late call', '2026-11-02T14:00:00Z'), ev('Early flight', '2026-11-02T16:00:00Z')];
  const groups = digest.groupByDay(events, 540);
  assert.deepEqual(
    Object.fromEntries(Object.entries(groups).map(([d, l]) => [d, l.map((e) => e.title)])),
    { '2026-11-02': ['Late call'], '2026-11-03': ['Early flight'] },
    'events must be grouped by the local (offset) date, not the UTC date',
  );
});

test('format.relative describes a time difference in words', () => {
  assert.equal(typeof format.relative, 'function', 'format.js must export relative(ms)');
  const min = 60 * 1000;
  assert.equal(format.relative(2 * 60 * min), 'in 2 h');
  assert.equal(format.relative(35 * min), 'in 35 min');
  assert.equal(format.relative(30 * 1000), 'now', 'under 60 seconds either way is "now"');
  assert.equal(format.relative(-30 * 1000), 'now');
  assert.equal(format.relative(-5 * min), '5 min ago');
  assert.equal(format.relative(-3 * 60 * min), '3 h ago');
});
__FIXTURE_EOF__

cat > test/notify/quiet.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as quiet from '../../src/notify/quiet.js';
import * as format from '../../src/notify/format.js';

const nap = { start: '13:00', end: '15:00' };
const night = { start: '22:00', end: '07:00' };

test('parseClock and formatClock round-trip', () => {
  assert.equal(format.parseClock('07:30'), 450);
  assert.equal(format.formatClock(450), '07:30');
  assert.equal(format.formatClock(1440 + 5), '00:05');
  assert.throws(() => format.parseClock('25:00'), /bad time/);
});

test('isQuiet inside a same-day window', () => {
  assert.equal(quiet.isQuiet('13:00', nap), true);
  assert.equal(quiet.isQuiet('14:59', nap), true);
  assert.equal(quiet.isQuiet('15:00', nap), false);
  assert.equal(quiet.deliveryTime('14:00', nap), '15:00');
  assert.equal(quiet.deliveryTime('16:00', nap), '16:00');
});

test('quietMinutes handles windows that cross midnight', () => {
  assert.equal(quiet.quietMinutes(nap), 120);
  assert.equal(quiet.quietMinutes(night), 540);
});

test('isQuiet handles a window that crosses midnight (22:00-07:00)', () => {
  assert.equal(quiet.isQuiet('23:30', night), true, '23:30 is after 22:00, so it is quiet');
  assert.equal(quiet.isQuiet('03:00', night), true, '03:00 is before 07:00, so it is quiet');
  assert.equal(quiet.isQuiet('07:00', night), false, 'the end of the window is not quiet');
  assert.equal(quiet.isQuiet('12:00', night), false, 'midday is not quiet');
});
__FIXTURE_EOF__

cat > test/sync/conflict.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as conflict from '../../src/sync/conflict.js';

const v = (value, clock, id) => ({ key: 'milk', value, clock, id });

test('resolve prefers the higher clock', () => {
  const older = v('buy 1', 2, 'a');
  const newer = v('buy 2', 3, 'z');
  assert.equal(conflict.resolve(older, newer), newer);
  assert.equal(conflict.resolve(newer, older), newer);
  assert.equal(conflict.describe(older, newer), 'milk: kept z@3, dropped a@2');
});

test('isConflict means same clock and different content', () => {
  assert.equal(conflict.isConflict(v('x', 1, 'a'), v('y', 1, 'b')), true);
  assert.equal(conflict.isConflict(v('x', 1, 'a'), v('x', 1, 'b')), false);
  assert.equal(conflict.isConflict(v('x', 1, 'a'), v('y', 2, 'b')), false);
});

test('on a clock tie, resolve picks the lexicographically smaller id', () => {
  const fromA = v('buy 1', 4, 'device-a');
  const fromB = v('buy 2', 4, 'device-b');
  assert.equal(conflict.resolve(fromA, fromB), fromA, 'device-a < device-b, so device-a wins the tie');
  assert.equal(conflict.resolve(fromB, fromA), fromA, 'the winner must not depend on argument order');
});
__FIXTURE_EOF__

cat > test/sync/merge.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as merge from '../../src/sync/merge.js';
import * as clock from '../../src/sync/clock.js';

const rec = (key, value, c, id, extra = {}) => ({ key, value, clock: c, id, ...extra });

test('Lamport clock ticks and observes', () => {
  const c = clock.createClock('phone');
  assert.equal(clock.tick(c).time, 1);
  assert.equal(clock.observe(clock.tick(c), 7).time, 8);
  assert.ok(clock.compareClocks(1, 2) < 0);
  assert.equal(clock.highestClock([rec('a', 1, 3, 'x'), rec('b', 1, 9, 'x')]), 9);
  assert.throws(() => clock.createClock(''), /device id/);
});

test('merge keeps the newer version of each record, sorted by key', () => {
  const local = [rec('milk', 'buy 1', 2, 'phone'), rec('eggs', 'buy 6', 5, 'phone')];
  const remote = [rec('milk', 'buy 2', 4, 'tablet'), rec('bread', 'buy 1', 1, 'tablet')];
  assert.deepEqual(merge.merge(local, remote), [
    rec('bread', 'buy 1', 1, 'tablet'),
    rec('eggs', 'buy 6', 5, 'phone'),
    rec('milk', 'buy 2', 4, 'tablet'),
  ]);
});

test('live hides tombstones and advanceClock moves past merged records', () => {
  const records = [rec('a', 1, 3, 'x'), rec('b', null, 6, 'x', { deleted: true })];
  assert.deepEqual(merge.live(records).map((r) => r.key), ['a']);
  assert.equal(merge.advanceClock(clock.createClock('phone', 2), records).time, 7);
});

test('a newer local deletion beats an older remote live copy', () => {
  const tombstone = rec('milk', null, 5, 'phone', { deleted: true });
  const merged = merge.merge([tombstone], [rec('milk', 'buy 2', 3, 'tablet')]);
  assert.deepEqual(merged, [tombstone], 'the deletion has the higher clock, so it must win and be kept');
  assert.deepEqual(merge.live(merged), []);
});
__FIXTURE_EOF__

cat > test/tasks/assign.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as assign from '../../src/tasks/assign.js';
import * as rotation from '../../src/tasks/rotation.js';
import { createTask } from '../../src/tasks/task.js';

const tasks = ['t1', 't2', 't3', 't4'].map((id) => createTask({ id }));

test('roundRobin cycles through members and skips done tasks', () => {
  const members = [{ id: 'mom' }, { id: 'dad' }];
  const list = [...tasks, createTask({ id: 'old', done: true })];
  const got = assign.roundRobin(list, members);
  assert.deepEqual([...got], [['t1', 'mom'], ['t2', 'dad'], ['t3', 'mom'], ['t4', 'dad']]);
});

test('roundRobin never assigns to a member who is away', () => {
  const members = [{ id: 'mom' }, { id: 'dad', away: true }, { id: 'kid' }];
  const got = assign.roundRobin(tasks, members);
  assert.deepEqual(
    [...got.values()],
    ['mom', 'kid', 'mom', 'kid'],
    'dad is away, so the chores go round mom and kid only',
  );
});

test('loadByMember sums points per member', () => {
  const list = [createTask({ id: 'a', points: 3 }), createTask({ id: 'b', points: 2 }), createTask({ id: 'c' })];
  const assignments = new Map([['a', 'mom'], ['b', 'dad'], ['c', 'mom']]);
  assert.deepEqual([...assign.loadByMember(assignments, list)], [['mom', 4], ['dad', 2]]);
});

test('rotation schedule walks the members in order', () => {
  const r = rotation.createRotation('trash', ['ann', 'ben', 'cy']);
  assert.deepEqual(rotation.schedule(r, 'ann', 3), ['ann', 'ben', 'cy']);
  assert.equal(rotation.nextOwner(r, 'nobody'), 'ann');
  assert.equal(rotation.rename(r, 'bins').name, 'bins');
  assert.throws(() => rotation.createRotation('x', ['a', 'a']), /duplicate/);
});

test('nextOwner wraps from the last member back to the first', () => {
  const r = rotation.createRotation('trash', ['ann', 'ben', 'cy']);
  assert.equal(rotation.nextOwner(r, 'cy'), 'ann', 'after the last member the rotation starts over');
});
__FIXTURE_EOF__

cat > test/tasks/task.test.js <<'__FIXTURE_EOF__'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as task from '../../src/tasks/task.js';

const now = new Date('2026-11-02T08:00:00Z');
const inHours = (h) => new Date(now.getTime() + h * 3600 * 1000);

test('createTask validates id and points', () => {
  assert.equal(task.createTask({ id: 't1', title: 'Dishes' }).points, 1);
  assert.throws(() => task.createTask({ title: 'x' }), /needs an id/);
  assert.throws(() => task.createTask({ id: 't', points: 0 }), /positive integer/);
});

test('complete marks a task done without mutating it', () => {
  const t = task.createTask({ id: 't1' });
  const done = task.complete(t, now);
  assert.equal(t.done, false);
  assert.equal(done.done, true);
  assert.equal(done.doneAt, now);
  assert.equal(task.isOpen(done), false);
});

test('overdue returns open tasks whose due time has passed', () => {
  const tasks = [
    task.createTask({ id: 'late', due: inHours(-1) }),
    task.createTask({ id: 'later', due: inHours(3) }),
    task.createTask({ id: 'done-late', due: inHours(-2), done: true }),
  ];
  assert.deepEqual(task.overdue(tasks, now).map((t) => t.id), ['late']);
  assert.equal(task.totalPoints(tasks), 3);
});

test('dueSoon returns open tasks due within the next N hours, soonest first', () => {
  assert.equal(typeof task.dueSoon, 'function', 'task.js must export dueSoon(tasks, now, hours)');
  const tasks = [
    task.createTask({ id: 'in5h', due: inHours(5) }),
    task.createTask({ id: 'in30h', due: inHours(30) }),
    task.createTask({ id: 'in1h', due: inHours(1) }),
    task.createTask({ id: 'overdue', due: inHours(-1) }),
    task.createTask({ id: 'done', due: inHours(2), done: true }),
    task.createTask({ id: 'no-due' }),
  ];
  assert.deepEqual(
    task.dueSoon(tasks, now, 24).map((t) => t.id),
    ['in1h', 'in5h'],
    'only open tasks with now <= due <= now + hours, sorted by due',
  );
});
__FIXTURE_EOF__

git init -q -b main
git -c user.name=fixture -c user.email=fixture@example.invalid add -A
git -c user.name=fixture -c user.email=fixture@example.invalid commit -q -m "fixture"
