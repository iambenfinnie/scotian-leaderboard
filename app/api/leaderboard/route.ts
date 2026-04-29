import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SHEET_ID = '1ik1jZ0R0-iLwDRjzz7xuXx1IC9eYGJx31O34w-k8Urg';

function parseCSVRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseMoney(val: string): number {
  if (!val) return 0;
  return parseFloat(val.replace(/[$,\s]/g, '')) || 0;
}

function parseDate(val: string): Date | null {
  if (!val?.trim()) return null;
  const s = val.trim();
  // M/D/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  // YYYY-MM-DD or MM-DD-YYYY HH:MM ...
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
  const dmy = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (dmy) return new Date(parseInt(dmy[3]), parseInt(dmy[1]) - 1, parseInt(dmy[2]));
  return null;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString('en-CA', {
    month: 'long',
    year: 'numeric',
  });
}

// Returns the ISO date string of the Monday that starts the week containing d
function weekKey(d: Date): string {
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
}

function weekLabel(key: string): string {
  const monday = new Date(key + 'T00:00:00');
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt: Date) =>
    dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

interface CloserAccum {
  name: string;
  leads: number;
  sits: number;
  deals: number;
  revenue: number;
  seenLeadIds: Set<string>;
  monthly: Record<string, { revenue: number; deals: number; sits: number }>;
  weekly: Record<string, { revenue: number; deals: number; sits: number }>;
}

export async function GET() {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

    const text = await res.text();
    const lines = text.split(/\r?\n/);

    const closers = new Map<string, CloserAccum>();

    // Track globally seen lead IDs to deduplicate identical rows
    const globalSeen = new Set<string>();

    for (const line of lines) {
      if (!line.trim()) continue;
      const row = parseCSVRow(line);
      if (row.length < 8) continue;

      const dealStatus = row[7]?.trim();
      if (dealStatus !== 'Sold' && dealStatus !== 'Not Sold') continue;

      const leadId = row[0]?.trim();
      const closerRaw = row[3]?.trim() || '';
      const closer = closerRaw.replace(/❌\s*/g, '').trim();
      if (!closer) continue;

      // Deduplicate exact row (same lead + same closer)
      const dedupKey = `${leadId}__${closer}`;
      if (globalSeen.has(dedupKey)) continue;
      globalSeen.add(dedupKey);

      const sitCompleted = row[6]?.trim().toLowerCase() === 'yes';
      const isSold = dealStatus === 'Sold';
      const dealValue = parseMoney(row[8]);
      const soldDate = parseDate(row[9]);

      if (!closers.has(closer)) {
        closers.set(closer, {
          name: closer,
          leads: 0,
          sits: 0,
          deals: 0,
          revenue: 0,
          seenLeadIds: new Set(),
          monthly: {},
          weekly: {},
        });
      }

      const c = closers.get(closer)!;
      c.leads++;
      if (sitCompleted) c.sits++;

      // Track sit per period using soldDate as proxy (best available date)
      if (sitCompleted && soldDate) {
        const mk = monthKey(soldDate);
        const wk = weekKey(soldDate);
        if (!c.monthly[mk]) c.monthly[mk] = { revenue: 0, deals: 0, sits: 0 };
        if (!c.weekly[wk]) c.weekly[wk] = { revenue: 0, deals: 0, sits: 0 };
        c.monthly[mk].sits++;
        c.weekly[wk].sits++;
      }

      if (isSold && dealValue > 0) {
        c.deals++;
        c.revenue += dealValue;

        if (soldDate) {
          const mk = monthKey(soldDate);
          const wk = weekKey(soldDate);
          if (!c.monthly[mk]) c.monthly[mk] = { revenue: 0, deals: 0, sits: 0 };
          if (!c.weekly[wk]) c.weekly[wk] = { revenue: 0, deals: 0, sits: 0 };
          c.monthly[mk].revenue += dealValue;
          c.monthly[mk].deals++;
          c.weekly[wk].revenue += dealValue;
          c.weekly[wk].deals++;
        }
      }
    }

    const leaderboard = Array.from(closers.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((c, i) => ({
        rank: i + 1,
        name: c.name,
        revenue: c.revenue,
        deals: c.deals,
        leads: c.leads,
        sits: c.sits,
        closeRatePerLead: c.leads > 0 ? c.deals / c.leads : 0,
        closeRatePerSit: c.sits > 0 ? c.deals / c.sits : 0,
        revenuePerSit: c.sits > 0 ? c.revenue / c.sits : 0,
        monthly: c.monthly,
        weekly: c.weekly,
      }));

    // Collect all months that have data
    const allMonths = new Set<string>();
    for (const c of leaderboard) {
      for (const mk of Object.keys(c.monthly)) allMonths.add(mk);
    }
    const sortedMonths = Array.from(allMonths)
      .sort()
      .reverse()
      .map(mk => ({ key: mk, label: monthLabel(mk) }));

    // Collect all weeks that have data, most recent 8
    const allWeeks = new Set<string>();
    for (const c of leaderboard) {
      for (const wk of Object.keys(c.weekly)) allWeeks.add(wk);
    }
    const sortedWeeks = Array.from(allWeeks)
      .sort()
      .reverse()
      .slice(0, 8)
      .map(wk => ({ key: wk, label: weekLabel(wk) }));

    return NextResponse.json({
      leaderboard,
      totalRevenue: leaderboard.reduce((s, c) => s + c.revenue, 0),
      totalDeals: leaderboard.reduce((s, c) => s + c.deals, 0),
      months: sortedMonths,
      weeks: sortedWeeks,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Leaderboard fetch error:', err);
    return NextResponse.json({ error: 'Failed to load data' }, { status: 500 });
  }
}
