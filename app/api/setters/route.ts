import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_KEY = process.env.REPCARD_API_KEY;
const BASE = 'https://app.repcard.com/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RepCardAppointment {
  id: number;
  startAt: string; // "YYYY-MM-DD HH:MM:SS"
  createdAt: string;
  setter: {
    id: number;
    fullName: string;
  } | null;
  status: {
    id: number;
    title: string;
    category: {
      id: number;
      title: string; // "Held" | "Not Held"
    };
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
  name: string;
  sat: number;
  noshow: number;
  cancel: number;
  pending: number;
  monthly: Record<string, PeriodCounts>;
  weekly: Record<string, PeriodCounts>;
}

// ── Status classification ─────────────────────────────────────────────────────
// Based on Scotian Heat Pumps' actual RepCard outcome setup:
//   Held category   → appointment was sat
//   "APT SAT BUT NOT SOLD" / "SAT NOT CLOSED" → sat despite being in Not Held
//   "NO SHOW" / "Not Interested" (Not Held) → no-show
//   "Rescheduled"   → cancelled/rescheduled (excluded from show rate)
//   null status     → upcoming/pending

function classifyStatus(appt: RepCardAppointment): NormStatus {
  if (!appt.status) return 'pending';

  const title = appt.status.title.toUpperCase();
  const category = appt.status.category?.title;

  // Appointments that sat even though they're in "Not Held" category
  if (title.includes('SAT')) return 'sat';

  if (category === 'Held') return 'sat';

  // Explicit rescheduled → treat as cancel (excluded from show rate calc)
  if (title.includes('RESCHEDUL')) return 'cancel';

  // Everything else in "Not Held" is a no-show (NO SHOW, Not Interested at door, etc.)
  return 'noshow';
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseRepCardDate(s: string): Date | null {
  if (!s) return null;
  // "2025-04-07 22:00:00" → replace space with T for standard parsing
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
  // Strip the ❌ prefix RepCard adds to deactivated users
  return raw.replace(/^[^\w\s]*\s*/, '').trim();
}

// ── RepCard API fetch (paginated, YTD) ────────────────────────────────────────

async function fetchAppointments(): Promise<RepCardAppointment[]> {
  const all: RepCardAppointment[] = [];
  const fromDate = `${new Date().getFullYear()}-01-01`;
  let page = 1;

  while (true) {
    const url = `${BASE}/appointments?from_date=${fromDate}&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { 'x-api-key': API_KEY! },
      cache: 'no-store',
    });

    if (!res.ok) throw new Error(`RepCard API error: ${res.status} ${res.statusText}`);

    const json = await res.json();
    if (!json.status) throw new Error(json.message ?? 'RepCard API returned an error');

    const result = json.result ?? {};
    const items: RepCardAppointment[] = result.data ?? [];

    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);

    const totalPages: number = result.totalPages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return all;
}

// ── Data processing ───────────────────────────────────────────────────────────

function processAppointments(appointments: RepCardAppointment[]) {
  const setters = new Map<string, SetterAccum>();

  for (const appt of appointments) {
    if (!appt.setter) continue;

    const name = cleanName(appt.setter.fullName);
    if (!name) continue;

    const norm = classifyStatus(appt);

    if (!setters.has(name)) {
      setters.set(name, {
        name,
        sat: 0,
        noshow: 0,
        cancel: 0,
        pending: 0,
        monthly: {},
        weekly: {},
      });
    }

    const s = setters.get(name)!;
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

// ── Demo data (shown when REPCARD_API_KEY is not configured) ──────────────────

function getDemoData(): Map<string, SetterAccum> {
  const raw = [
    { name: 'Olivia Clarke', sat: 38, noshow: 12, cancel: 8, pending: 5 },
    { name: 'Tyler Marsh', sat: 31, noshow: 15, cancel: 10, pending: 3 },
    { name: 'Jordan Lee', sat: 27, noshow: 9, cancel: 6, pending: 7 },
    { name: 'Priya Kapoor', sat: 24, noshow: 18, cancel: 11, pending: 2 },
    { name: 'Marcus Webb', sat: 19, noshow: 11, cancel: 7, pending: 4 },
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

  const setters = new Map<string, SetterAccum>();
  const monthFracs = [0.35, 0.3, 0.22, 0.13];
  const weekFracs = [0.2, 0.18, 0.16, 0.14, 0.12, 0.08, 0.07, 0.05];

  for (const sd of raw) {
    const monthly: SetterAccum['monthly'] = {};
    const weekly: SetterAccum['weekly'] = {};

    for (let i = 0; i < months.length; i++) {
      const f = monthFracs[i];
      monthly[months[i]] = {
        sat: Math.round(sd.sat * f),
        noshow: Math.round(sd.noshow * f),
        cancel: Math.round(sd.cancel * f),
        pending: i === 0 ? sd.pending : 0,
      };
    }

    for (let i = 0; i < weeks.length; i++) {
      const f = weekFracs[i];
      weekly[weeks[i]] = {
        sat: Math.round(sd.sat * f),
        noshow: Math.round(sd.noshow * f),
        cancel: Math.round(sd.cancel * f),
        pending: i === 0 ? sd.pending : 0,
      };
    }

    setters.set(sd.name, { ...sd, monthly, weekly });
  }

  return setters;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    let setterMap: Map<string, SetterAccum>;
    let isDemo = false;

    if (!API_KEY) {
      setterMap = getDemoData();
      isDemo = true;
    } else {
      const appointments = await fetchAppointments();
      setterMap = processAppointments(appointments);
    }

    const setters = Array.from(setterMap.values())
      .map(s => {
        const showable = s.sat + s.noshow;
        const totalBooked = s.sat + s.noshow + s.cancel + s.pending;
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
      })
      .sort((a, b) => b.totalBooked - a.totalBooked)
      .map((s, i) => ({ ...s, rank: i + 1 }));

    const allMonths = new Set<string>();
    const allWeeks = new Set<string>();
    for (const s of setters) {
      Object.keys(s.monthly).forEach(k => allMonths.add(k));
      Object.keys(s.weekly).forEach(k => allWeeks.add(k));
    }

    const months = Array.from(allMonths)
      .sort()
      .reverse()
      .map(k => ({ key: k, label: monthLabel(k) }));

    const weeks = Array.from(allWeeks)
      .sort()
      .reverse()
      .slice(0, 8)
      .map(k => ({ key: k, label: weekLabel(k) }));

    const ratedSetters = setters.filter(s => s.sat + s.noshow > 0);
    const teamShowRate =
      ratedSetters.length > 0
        ? ratedSetters.reduce((s, c) => s + c.showRate, 0) / ratedSetters.length
        : 0;

    return NextResponse.json({
      setters,
      totalAppointments: setters.reduce((s, c) => s + c.totalBooked, 0),
      teamShowRate,
      months,
      weeks,
      isDemo,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Setters fetch error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
