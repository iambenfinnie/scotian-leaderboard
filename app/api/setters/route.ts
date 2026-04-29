import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_KEY = process.env.REPCARD_API_KEY;
const BASE = 'https://app.repcard.com/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RepCardAppointment {
  id: number;
  startAt: string;
  setter: { id: number; fullName: string } | null;
  status: {
    id: number;
    title: string;
    category: { id: number; title: string };
  } | null;
}

type NormStatus = 'sat' | 'noshow' | 'cancel' | 'pending';

interface PeriodCounts {
  sat: number;
  noshow: number;
  cancel: number;
  pending: number;
}

interface SetterAccum {
  userId: number;
  name: string;
  sat: number;
  noshow: number;
  cancel: number;
  pending: number;
  monthly: Record<string, PeriodCounts>;
  weekly: Record<string, PeriodCounts>;
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

function cleanName(raw: string): string {
  return raw.replace(/^[^\w\s]*\s*/, '').trim();
}

// ── API fetcher ───────────────────────────────────────────────────────────────

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

async function fetchAll(
  fetchFn: (page: number) => Promise<{ items: RepCardAppointment[]; totalPages: number }>,
  batchSize = 10,
  batchDelayMs = 0,
): Promise<RepCardAppointment[]> {
  const first = await fetchFn(1);
  if (first.totalPages <= 1) return first.items;

  const all = [...first.items];
  for (let start = 2; start <= first.totalPages; start += batchSize) {
    const end = Math.min(start + batchSize - 1, first.totalPages);
    const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const results = await Promise.all(pages.map(p => fetchFn(p)));
    for (const r of results) all.push(...r.items);
    if (batchDelayMs > 0 && end < first.totalPages) {
      await new Promise(r => setTimeout(r, batchDelayMs));
    }
  }
  return all;
}

// ── Module-level cache ────────────────────────────────────────────────────────

interface Cache<T> { data: T; expiresAt: number; }
const apptCache = new Map<string, Cache<RepCardAppointment[]>>();
const CACHE_TTL = 10 * 60 * 1000;

async function fetchAppointments(fromDate: string, toDate: string): Promise<RepCardAppointment[]> {
  const key = `${fromDate}:${toDate}`;
  const cached = apptCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
  const data = await fetchAll(p => fetchApptPage(p, fromDate, toDate), 3, 150);
  apptCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
  return data;
}

// ── Data processing ───────────────────────────────────────────────────────────

function buildSetterMap(appointments: RepCardAppointment[]): Map<number, SetterAccum> {
  const setters = new Map<number, SetterAccum>();

  function getSetter(userId: number, name: string): SetterAccum {
    if (!setters.has(userId)) {
      setters.set(userId, {
        userId, name,
        sat: 0, noshow: 0, cancel: 0, pending: 0,
        monthly: {}, weekly: {},
      });
    }
    return setters.get(userId)!;
  }

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

  return setters;
}

// ── Demo data ─────────────────────────────────────────────────────────────────

function getDemoData(): Map<number, SetterAccum> {
  const raw = [
    { id: 1, name: 'Olivia Clarke', sat: 38, noshow: 12, cancel: 8, pending: 5 },
    { id: 2, name: 'Tyler Marsh', sat: 31, noshow: 15, cancel: 10, pending: 3 },
    { id: 3, name: 'Jordan Lee', sat: 27, noshow: 9, cancel: 6, pending: 7 },
    { id: 4, name: 'Priya Kapoor', sat: 24, noshow: 18, cancel: 11, pending: 2 },
    { id: 5, name: 'Marcus Webb', sat: 19, noshow: 11, cancel: 7, pending: 4 },
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

    for (let i = 0; i < months.length; i++) {
      const f = mf[i];
      monthly[months[i]] = {
        sat: Math.round(sd.sat * f),
        noshow: Math.round(sd.noshow * f),
        cancel: Math.round(sd.cancel * f),
        pending: i === 0 ? sd.pending : 0,
      };
    }
    for (let i = 0; i < weeks.length; i++) {
      const f = wf[i];
      weekly[weeks[i]] = {
        sat: Math.round(sd.sat * f),
        noshow: Math.round(sd.noshow * f),
        cancel: Math.round(sd.cancel * f),
        pending: i === 0 ? sd.pending : 0,
      };
    }

    setters.set(sd.id, { userId: sd.id, name: sd.name, sat: sd.sat, noshow: sd.noshow, cancel: sd.cancel, pending: sd.pending, monthly, weekly });
  }

  return setters;
}

// ── Summarize ─────────────────────────────────────────────────────────────────

function summarize(s: SetterAccum) {
  const totalBooked = s.sat + s.noshow + s.cancel + s.pending;
  const showable = s.sat + s.noshow;
  const showRate = showable > 0 ? s.sat / showable : 0;
  return {
    name: s.name,
    totalBooked,
    sat: s.sat,
    noshow: s.noshow,
    cancel: s.cancel,
    pending: s.pending,
    showRate,
    monthly: s.monthly,
    weekly: s.weekly,
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

    if (!API_KEY) {
      setterMap = getDemoData();
      isDemo = true;
    } else {
      const appointments = await fetchAppointments(fromDate, toDate);
      setterMap = buildSetterMap(appointments);
    }

    const setters = Array.from(setterMap.values())
      .map(summarize)
      .filter(s => s.totalBooked > 0)
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

    const availableYears: number[] = [];
    for (let y = currentYear; y >= 2025; y--) availableYears.push(y);

    return NextResponse.json({
      setters,
      totalAppointments: setters.reduce((s, c) => s + c.totalBooked, 0),
      totalShows: setters.reduce((s, c) => s + c.sat, 0),
      teamShowRate,
      months,
      weeks,
      year,
      availableYears,
      isDemo,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Setters fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
