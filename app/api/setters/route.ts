import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_KEY = process.env.REPCARD_API_KEY;
const BASE = 'https://app.repcard.com/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RepCardAppointment {
  id: number;
  startAt: string;
  createdAt: string;
  setter: { id: number; fullName: string } | null;
  status: {
    id: number;
    title: string;
    category: { id: number; title: string };
  } | null;
}

interface StatusLog {
  userId: number;
  createdAt: string;
  user: { id: number; firstName: string; lastName: string } | null;
  statusTo: { statusName: string } | null;
}

type NormStatus = 'sat' | 'noshow' | 'cancel' | 'pending';

interface PeriodCounts {
  sat: number;
  noshow: number;
  cancel: number;
  pending: number;
}

interface DoorPeriod {
  doors: number;
  dms: number;
  fieldMinutes: number;
}

interface SetterAccum {
  userId: number;
  name: string;
  // Appointment stats
  sat: number;
  noshow: number;
  cancel: number;
  pending: number;
  monthly: Record<string, PeriodCounts>;
  weekly: Record<string, PeriodCounts>;
  // Door knock stats
  doors: number;
  dms: number;
  dayStats: Record<string, { start: number; end: number }>; // date → {start,end} minutes since midnight (Halifax)
  monthlyDoor: Record<string, DoorPeriod>;
  weeklyDoor: Record<string, DoorPeriod>;
}

// ── Status classification ─────────────────────────────────────────────────────

function classifyStatus(appt: RepCardAppointment): NormStatus {
  if (!appt.status) return 'pending';
  const title = appt.status.title.toUpperCase();
  const category = appt.status.category?.title;
  if (title.includes('SAT')) return 'sat';
  if (category === 'Held') return 'sat';
  if (title.includes('RESCHEDUL')) return 'cancel';
  return 'noshow';
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseRepCardDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d;
}

function toHalifax(utcStr: string): Date {
  const d = new Date(utcStr);
  // Convert UTC timestamp to Halifax local time
  const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/Halifax' }));
  return local;
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
  });
}

function weekKey(d: Date) {
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
}

function weekLabel(key: string) {
  const monday = new Date(key + 'T00:00:00');
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt: Date) =>
    dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function emptyPeriod(): PeriodCounts {
  return { sat: 0, noshow: 0, cancel: 0, pending: 0 };
}

function emptyDoorPeriod(): DoorPeriod {
  return { doors: 0, dms: 0, fieldMinutes: 0 };
}

function cleanName(raw: string): string {
  return raw.replace(/^[^\w\s]*\s*/, '').trim();
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ── API fetchers ──────────────────────────────────────────────────────────────

async function fetchApptPage(
  page: number,
  fromDate: string,
  toDate: string,
): Promise<{ items: RepCardAppointment[]; totalPages: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(
      `${BASE}/appointments?from_date=${fromDate}&to_date=${toDate}&per_page=100&page=${page}`,
      { headers: { 'x-api-key': API_KEY! }, cache: 'no-store' },
    );
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      continue;
    }
    if (!res.ok) throw new Error(`Appointments API error: ${res.status}`);
    const json = await res.json();
    if (!json.status) throw new Error(json.message ?? 'RepCard error');
    const result = json.result ?? {};
    return { items: result.data ?? [], totalPages: result.totalPages ?? 1 };
  }
  throw new Error('Appointments API error: 429 after retries');
}

const LOG_PER_PAGE = 1000; // try large page size to reduce total requests

async function fetchLogPage(
  page: number,
  fromDate: string,
  toDate: string,
): Promise<{ items: StatusLog[]; totalCount: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(
      `${BASE}/customers/status-logs?from_date=${fromDate}&to_date=${toDate}&per_page=${LOG_PER_PAGE}&page=${page}`,
      { headers: { 'x-api-key': API_KEY! }, cache: 'no-store' },
    );
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      continue;
    }
    if (!res.ok) throw new Error(`Status logs API error: ${res.status}`);
    const json = await res.json();
    const result = json.result ?? json;
    return { items: result.data ?? [], totalCount: result.totalCount ?? 0 };
  }
  throw new Error('Status logs API error: 429 after retries');
}

async function fetchAll<T>(
  fetchFn: (page: number) => Promise<{ items: T[]; totalPages?: number; totalCount?: number }>,
  batchSize = 10,
  batchDelayMs = 0,
): Promise<T[]> {
  const first = await fetchFn(1);
  const totalPages =
    first.totalPages ?? (first.totalCount ? Math.ceil(first.totalCount / 100) : 1);

  if (totalPages <= 1) return first.items;

  const all = [...first.items];

  for (let start = 2; start <= totalPages; start += batchSize) {
    const end = Math.min(start + batchSize - 1, totalPages);
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const results = await Promise.all(pages.map(p => fetchFn(p)));
    for (const r of results) all.push(...r.items);
    if (batchDelayMs > 0 && end < totalPages) {
      await new Promise(r => setTimeout(r, batchDelayMs));
    }
  }

  return all;
}

// ── Module-level cache to avoid re-fetching on every auto-refresh ─────────────

interface Cache<T> { data: T; expiresAt: number; }
const apptCache = new Map<string, Cache<RepCardAppointment[]>>();
const logCacheStore = new Map<string, Cache<StatusLog[]>>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchAppointments(fromDate: string, toDate: string): Promise<RepCardAppointment[]> {
  const key = `${fromDate}:${toDate}`;
  const cached = apptCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const data = await fetchAll(
    p => fetchApptPage(p, fromDate, toDate),
    3,   // 3 concurrent pages
    150, // 150ms between batches
  );
  apptCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
  return data;
}

async function fetchStatusLogs(fromDate: string, toDate: string): Promise<StatusLog[]> {
  const key = `${fromDate}:${toDate}`;
  const cached = logCacheStore.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const data = await fetchAll(
    p => fetchLogPage(p, fromDate, toDate).then(r => ({ items: r.items, totalPages: Math.ceil((r.totalCount || 1) / LOG_PER_PAGE) })),
    2,   // 2 concurrent pages
    300, // 300ms between batches
  );
  logCacheStore.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
  return data;
}

// ── Data processing ───────────────────────────────────────────────────────────

function buildSetterMap(
  appointments: RepCardAppointment[],
  statusLogs: StatusLog[],
): Map<number, SetterAccum> {
  const setters = new Map<number, SetterAccum>();

  // Helper to get or create a setter entry
  function getSetter(userId: number, name: string): SetterAccum {
    if (!setters.has(userId)) {
      setters.set(userId, {
        userId,
        name,
        sat: 0, noshow: 0, cancel: 0, pending: 0,
        monthly: {}, weekly: {},
        doors: 0, dms: 0,
        dayStats: {},
        monthlyDoor: {}, weeklyDoor: {},
      });
    }
    return setters.get(userId)!;
  }

  // Process appointments
  for (const appt of appointments) {
    if (!appt.setter) continue;
    const name = cleanName(appt.setter.fullName);
    if (!name) continue;

    const s = getSetter(appt.setter.id, name);
    const norm = classifyStatus(appt);
    s[norm]++;

    const d = parseRepCardDate(appt.startAt);
    if (d) {
      const mk = monthKey(d);
      const wk = weekKey(d);
      if (!s.monthly[mk]) s.monthly[mk] = emptyPeriod();
      if (!s.weekly[wk]) s.weekly[wk] = emptyPeriod();
      s.monthly[mk][norm]++;
      s.weekly[wk][norm]++;
    }
  }

  // Process status logs (door knocks)
  for (const log of statusLogs) {
    if (!log.user) continue;
    const rawName = `${log.user.firstName ?? ''} ${log.user.lastName ?? ''}`.trim();
    const name = cleanName(rawName);
    if (!name) continue;

    const s = getSetter(log.userId, name);
    const isNotHome = log.statusTo?.statusName === 'Not Home';

    s.doors++;
    if (!isNotHome) s.dms++;

    // Convert to Halifax local time for accurate time-of-day calculations
    const local = toHalifax(log.createdAt);
    const minuteOfDay = local.getHours() * 60 + local.getMinutes();
    const dateKey = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;

    // Track first/last knock per calendar day
    if (!s.dayStats[dateKey]) {
      s.dayStats[dateKey] = { start: minuteOfDay, end: minuteOfDay };
    } else {
      s.dayStats[dateKey].start = Math.min(s.dayStats[dateKey].start, minuteOfDay);
      s.dayStats[dateKey].end = Math.max(s.dayStats[dateKey].end, minuteOfDay);
    }

    // Monthly/weekly door counts
    const mk = monthKey(local);
    const wk = weekKey(local);
    if (!s.monthlyDoor[mk]) s.monthlyDoor[mk] = emptyDoorPeriod();
    if (!s.weeklyDoor[wk]) s.weeklyDoor[wk] = emptyDoorPeriod();
    s.monthlyDoor[mk].doors++;
    s.weeklyDoor[wk].doors++;
    if (!isNotHome) {
      s.monthlyDoor[mk].dms++;
      s.weeklyDoor[wk].dms++;
    }
  }

  // Aggregate per-day field minutes into monthly/weekly buckets
  for (const s of setters.values()) {
    for (const [dateKey, { start, end }] of Object.entries(s.dayStats)) {
      const fieldMins = Math.max(0, end - start);
      const d = new Date(dateKey + 'T12:00:00');
      const mk = monthKey(d);
      const wk = weekKey(d);
      if (s.monthlyDoor[mk]) s.monthlyDoor[mk].fieldMinutes += fieldMins;
      if (s.weeklyDoor[wk]) s.weeklyDoor[wk].fieldMinutes += fieldMins;
    }
  }

  return setters;
}

// ── Demo data ─────────────────────────────────────────────────────────────────

function getDemoData(): Map<number, SetterAccum> {
  const raw = [
    { id: 1, name: 'Olivia Clarke', sat: 38, noshow: 12, cancel: 8, pending: 5, doors: 520, dms: 210 },
    { id: 2, name: 'Tyler Marsh', sat: 31, noshow: 15, cancel: 10, pending: 3, doors: 480, dms: 175 },
    { id: 3, name: 'Jordan Lee', sat: 27, noshow: 9, cancel: 6, pending: 7, doors: 390, dms: 145 },
    { id: 4, name: 'Priya Kapoor', sat: 24, noshow: 18, cancel: 11, pending: 2, doors: 440, dms: 160 },
    { id: 5, name: 'Marcus Webb', sat: 19, noshow: 11, cancel: 7, pending: 4, doors: 310, dms: 120 },
  ];

  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const weeks: string[] = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    weeks.push(monday.toISOString().slice(0, 10));
  }

  const setters = new Map<number, SetterAccum>();
  const mf = [0.35, 0.3, 0.22, 0.13];
  const wf = [0.2, 0.18, 0.16, 0.14, 0.12, 0.08, 0.07, 0.05];

  for (const sd of raw) {
    const monthly: SetterAccum['monthly'] = {};
    const weekly: SetterAccum['weekly'] = {};
    const monthlyDoor: SetterAccum['monthlyDoor'] = {};
    const weeklyDoor: SetterAccum['weeklyDoor'] = {};

    for (let i = 0; i < months.length; i++) {
      const f = mf[i];
      monthly[months[i]] = { sat: Math.round(sd.sat * f), noshow: Math.round(sd.noshow * f), cancel: Math.round(sd.cancel * f), pending: i === 0 ? sd.pending : 0 };
      monthlyDoor[months[i]] = { doors: Math.round(sd.doors * f), dms: Math.round(sd.dms * f), fieldMinutes: Math.round(1800 * f) };
    }
    for (let i = 0; i < weeks.length; i++) {
      const f = wf[i];
      weekly[weeks[i]] = { sat: Math.round(sd.sat * f), noshow: Math.round(sd.noshow * f), cancel: Math.round(sd.cancel * f), pending: i === 0 ? sd.pending : 0 };
      weeklyDoor[weeks[i]] = { doors: Math.round(sd.doors * f), dms: Math.round(sd.dms * f), fieldMinutes: Math.round(1800 * f) };
    }

    // Fake day stats: 8:30 AM start, 6:30 PM end, 20 working days
    const dayStats: SetterAccum['dayStats'] = {};
    for (let i = 0; i < 20; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dk = d.toISOString().slice(0, 10);
      dayStats[dk] = { start: 510 + Math.floor(Math.random() * 30), end: 1080 + Math.floor(Math.random() * 60) };
    }

    setters.set(sd.id, { userId: sd.id, name: sd.name, sat: sd.sat, noshow: sd.noshow, cancel: sd.cancel, pending: sd.pending, monthly, weekly, doors: sd.doors, dms: sd.dms, dayStats, monthlyDoor, weeklyDoor });
  }

  return setters;
}

// ── Compute summary stats from a SetterAccum ──────────────────────────────────

function summarize(s: SetterAccum) {
  const totalBooked = s.sat + s.noshow + s.cancel + s.pending;
  const showable = s.sat + s.noshow;
  const showRate = showable > 0 ? s.sat / showable : 0;
  const closeRatio = s.dms > 0 ? s.sat / s.dms : 0;

  // Compute total field minutes and avg start/end from dayStats
  const days = Object.values(s.dayStats);
  const workingDays = days.length;
  const totalFieldMinutes = days.reduce((sum, d) => sum + Math.max(0, d.end - d.start), 0);
  const avgStartMinute = workingDays > 0
    ? Math.round(days.reduce((sum, d) => sum + d.start, 0) / workingDays)
    : 0;
  const avgEndMinute = workingDays > 0
    ? Math.round(days.reduce((sum, d) => sum + d.end, 0) / workingDays)
    : 0;

  return {
    name: s.name,
    totalBooked,
    sat: s.sat,
    noshow: s.noshow,
    cancel: s.cancel,
    pending: s.pending,
    showRate,
    doors: s.doors,
    dms: s.dms,
    closeRatio,
    totalFieldMinutes,
    workingDays,
    avgStartMinute,
    avgEndMinute,
    avgStartFmt: workingDays > 0 ? formatMinutes(avgStartMinute) : '—',
    avgEndFmt: workingDays > 0 ? formatMinutes(avgEndMinute) : '—',
    monthly: s.monthly,
    weekly: s.weekly,
    monthlyDoor: s.monthlyDoor,
    weeklyDoor: s.weeklyDoor,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const currentYear = new Date().getFullYear();
  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get('year') ?? String(currentYear));
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;

  try {
    let setterMap: Map<number, SetterAccum>;
    let isDemo = false;

    let doorStatsUnavailable = false;

    if (!API_KEY) {
      setterMap = getDemoData();
      isDemo = true;
    } else {
      const appointments = await fetchAppointments(fromDate, toDate);

      let statusLogs: StatusLog[] = [];
      try {
        statusLogs = await fetchStatusLogs(fromDate, toDate);
      } catch (e) {
        console.warn('Door stats unavailable:', e);
        doorStatsUnavailable = true;
      }

      setterMap = buildSetterMap(appointments, statusLogs);
    }

    const setters = Array.from(setterMap.values())
      .map(summarize)
      .filter(s => s.totalBooked > 0 || s.doors > 0)
      .sort((a, b) => b.totalBooked - a.totalBooked)
      .map((s, i) => ({ ...s, rank: i + 1 }));

    const allMonths = new Set<string>();
    const allWeeks = new Set<string>();
    for (const s of setters) {
      Object.keys(s.monthly).forEach(k => allMonths.add(k));
      Object.keys(s.weekly).forEach(k => allWeeks.add(k));
    }

    const months = Array.from(allMonths).sort().reverse().map(k => ({ key: k, label: monthLabel(k) }));
    const weeks = Array.from(allWeeks).sort().reverse().slice(0, 8).map(k => ({ key: k, label: weekLabel(k) }));

    const ratedSetters = setters.filter(s => s.sat + s.noshow > 0);
    const teamShowRate = ratedSetters.length > 0
      ? ratedSetters.reduce((s, c) => s + c.showRate, 0) / ratedSetters.length
      : 0;
    const teamCloseRatio = setters.filter(s => s.dms > 0).length > 0
      ? setters.filter(s => s.dms > 0).reduce((s, c) => s + c.closeRatio, 0) / setters.filter(s => s.dms > 0).length
      : 0;

    const availableYears: number[] = [];
    for (let y = currentYear; y >= 2025; y--) availableYears.push(y);

    return NextResponse.json({
      setters,
      totalAppointments: setters.reduce((s, c) => s + c.totalBooked, 0),
      totalDoors: setters.reduce((s, c) => s + c.doors, 0),
      teamShowRate,
      teamCloseRatio,
      months,
      weeks,
      year,
      availableYears,
      isDemo,
      doorStatsUnavailable,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Setters fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
