import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_KEY = process.env.REPCARD_API_KEY;
const BASE = 'https://api.repcard.com';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RepCardAppointment {
  id: string;
  status: string;
  appointment_date?: string;
  scheduled_at?: string;
  created_at?: string;
  rep?: { id: string; name?: string; first_name?: string; last_name?: string };
  user?: { id: string; name?: string; first_name?: string; last_name?: string };
  setter?: { id: string; name?: string; first_name?: string; last_name?: string };
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function toNormStatus(raw: string): NormStatus | null {
  const s = (raw ?? '').toLowerCase().replace(/[\s\-]/g, '_');
  if (/sat|complet|shown|sold/.test(s)) return 'sat';
  if (/no.?show|missed/.test(s)) return 'noshow';
  if (/cancel|reschedul/.test(s)) return 'cancel';
  if (/pending|schedul|upcoming|confirm/.test(s)) return 'pending';
  return null;
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

// ── RepCard API fetch (paginated) ─────────────────────────────────────────────

async function fetchRepCardAppointments(): Promise<RepCardAppointment[]> {
  const all: RepCardAppointment[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(`${BASE}/v1/appointments?page=${page}&per_page=100`, {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!res.ok) throw new Error(`RepCard API error: ${res.status} ${res.statusText}`);

    const json = await res.json();
    // Handle different response shapes RepCard might use
    const items: RepCardAppointment[] =
      json.data ?? json.appointments ?? json.results ?? (Array.isArray(json) ? json : []);

    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < 100 || all.length >= 5000) break;
    page++;
  }

  return all;
}

// ── Data processing ───────────────────────────────────────────────────────────

function processAppointments(appointments: RepCardAppointment[]) {
  const setters = new Map<string, SetterAccum>();

  for (const appt of appointments) {
    const person = appt.setter ?? appt.rep ?? appt.user;
    const name =
      person?.name ??
      (person?.first_name && person?.last_name
        ? `${person.first_name} ${person.last_name}`
        : person?.first_name ?? null);

    if (!name) continue;

    const norm = toNormStatus(appt.status);
    if (!norm) continue;

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

    const dateStr = appt.appointment_date ?? appt.scheduled_at ?? appt.created_at;
    if (dateStr) {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const mk = monthKey(d);
        const wk = weekKey(d);
        if (!s.monthly[mk]) s.monthly[mk] = emptyPeriod();
        if (!s.weekly[wk]) s.weekly[wk] = emptyPeriod();
        s.monthly[mk][norm]++;
        s.weekly[wk][norm]++;
      }
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

  for (const sd of raw) {
    const monthly: SetterAccum['monthly'] = {};
    const weekly: SetterAccum['weekly'] = {};

    const monthFracs = [0.35, 0.3, 0.22, 0.13];
    for (let i = 0; i < months.length; i++) {
      const f = monthFracs[i];
      monthly[months[i]] = {
        sat: Math.round(sd.sat * f),
        noshow: Math.round(sd.noshow * f),
        cancel: Math.round(sd.cancel * f),
        pending: i === 0 ? sd.pending : 0,
      };
    }

    const weekFracs = [0.2, 0.18, 0.16, 0.14, 0.12, 0.08, 0.07, 0.05];
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
      const appointments = await fetchRepCardAppointments();
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
      totalAppointments: setters.reduce((s, c) => s + s.totalBooked, 0),
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
