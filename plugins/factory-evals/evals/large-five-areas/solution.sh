#!/usr/bin/env bash
set -euo pipefail
# Reference solution for maintainers. Run in the fixture directory after fixture.sh.
# Overwrites only src/ files; tests are never touched.

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

// UTC date in iCal basic format, e.g. 20261224. Used for all-day events,
// which have no time and therefore no time zone.
export function dateStamp(date) {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
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
import { stamp, dateStamp } from './event.js';

const CRLF = '\r\n';
const MAX_OCTETS = 75;

// RFC 5545 3.1: lines longer than 75 octets are split with CRLF + one space.
// The limit is in bytes, and a UTF-8 character must never be cut in half.
export function foldLine(line) {
  const parts = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    // Continuation lines start with a space, which counts toward the 75.
    const limit = parts.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join(CRLF + ' ');
}

// All-day events carry DATE values; the others carry UTC DATE-TIME values.
function dateProp(name, date, allDay) {
  return allDay ? `${name};VALUE=DATE:${dateStamp(date)}` : `${name}:${stamp(date)}`;
}

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
    dateProp('DTSTART', event.start, event.allDay),
    dateProp('DTEND', event.end, event.allDay),
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
  return lines.map(foldLine).join(CRLF) + CRLF;
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
  for (let d = from; d <= until; d = addDays(d, 1)) {
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
    .map((e) => ({ name: e.name, short: e.qty - (have.get(normalizeName(e.name)) ?? 0) }))
    .filter((e) => e.short > 0);
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

cat > src/inventory/packing.js <<'__FIXTURE_EOF__'
// Packing for an event: what to bring and what is still missing.
import { hasTag, normalizeName } from './items.js';
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

// Items worth bringing: any item sharing at least one tag with the event, sorted by name.
export function suggest(event, items) {
  const wanted = new Set((event.tags ?? []).map(normalizeName));
  return items
    .filter((item) => item.tags.some((tag) => wanted.has(tag)))
    .sort((a, b) => a.name.localeCompare(b.name));
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
    const key = isoDay(new Date(event.start.getTime() + tz * 60000));
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

// Time difference in words: "in 2 h", "in 35 min", "now", "3 h ago".
// `ms` is target minus now, so a negative value is in the past.
export function relative(ms) {
  const abs = Math.abs(ms);
  if (abs < 60 * 1000) return 'now';
  const text = abs < 60 * 60 * 1000 ? `${Math.floor(abs / 60000)} min` : `${Math.floor(abs / 3600000)} h`;
  return ms > 0 ? `in ${text}` : `${text} ago`;
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
  if (start <= end) return t >= start && t < end;
  // The window crosses midnight, e.g. 22:00-07:00: quiet late at night or early in the morning.
  return t >= start || t < end;
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
  return a.id <= b.id ? a : b;
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
    // Keep tombstones: dropping them would let an older remote copy bring the record back.
    out.set(record.key, record);
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
  // Members who are away (holiday, school trip) get nothing.
  const present = members.filter((m) => !m.away);
  if (present.length === 0) throw new Error('nobody to assign to');
  const result = new Map();
  let i = 0;
  for (const task of tasks) {
    if (!isOpen(task)) continue;
    const member = present[i % present.length];
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
  return rotation.members[(idx + 1) % rotation.members.length];
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

// Open tasks due between now and now + hours (inclusive), soonest first.
// Overdue tasks are left out: `overdue` reports those.
export function dueSoon(tasks, now, hours) {
  const limit = now.getTime() + hours * 60 * 60 * 1000;
  return tasks
    .filter((t) => isOpen(t) && t.due !== null && t.due >= now && t.due.getTime() <= limit)
    .sort((a, b) => a.due - b.due);
}

export function totalPoints(tasks) {
  return tasks.reduce((sum, t) => sum + t.points, 0);
}
__FIXTURE_EOF__
