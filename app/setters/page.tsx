'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PeriodCounts {
  sat: number;
  noshow: number;
  cancel: number;
  pending: number;
}

interface SetterStats {
  rank: number;
  name: string;
  totalBooked: number;
  sat: number;
  noshow: number;
  cancel: number;
  pending: number;
  showRate: number;
  monthly: Record<string, PeriodCounts>;
  weekly: Record<string, PeriodCounts>;
}

interface ApiResponse {
  setters: SetterStats[];
  totalAppointments: number;
  teamShowRate: number;
  months: { key: string; label: string }[];
  weeks: { key: string; label: string }[];
  isDemo: boolean;
  updatedAt: string;
  error?: string;
}

// ── Formatters ────────────────────────────────────────────────────────────────

const REFRESH_SECONDS = 300;
const MEDALS = ['🥇', '🥈', '🥉'];

function fmtPct(r: number) {
  return `${(r * 100).toFixed(1)}%`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getCurrentWeekKey() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
}

function isWeekKey(key: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function showRateStyle(rate: number) {
  if (rate >= 0.7) return { bg: 'rgba(34,197,94,0.15)', color: '#22C55E' };
  if (rate >= 0.5) return { bg: 'rgba(234,179,8,0.15)', color: '#EAB308' };
  return { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettersPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('ytd');
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [refreshing, setRefreshing] = useState(false);
  const countdownRef = useRef(REFRESH_SECONDS);

  const fetchData = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/api/setters');
      if (!res.ok) throw new Error('Bad response');
      const json: ApiResponse = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setError(null);
      countdownRef.current = REFRESH_SECONDS;
      setCountdown(REFRESH_SECONDS);
    } catch {
      setError('Could not load setter data. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const timer = setInterval(() => {
      countdownRef.current -= 1;
      setCountdown(countdownRef.current);
      if (countdownRef.current <= 0) fetchData();
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const currentWeekKey = getCurrentWeekKey();

  // ── Compute display rows based on selected period ─────────────────────────
  const displaySetters: SetterStats[] = (() => {
    if (!data) return [];
    if (selectedPeriod === 'ytd') return data.setters;

    const periodMap = isWeekKey(selectedPeriod) ? 'weekly' : 'monthly';
    return data.setters
      .map(s => {
        const p: PeriodCounts = s[periodMap][selectedPeriod] ?? {
          sat: 0,
          noshow: 0,
          cancel: 0,
          pending: 0,
        };
        const showable = p.sat + p.noshow;
        return {
          ...s,
          totalBooked: p.sat + p.noshow + p.cancel + p.pending,
          sat: p.sat,
          noshow: p.noshow,
          cancel: p.cancel,
          pending: p.pending,
          showRate: showable > 0 ? p.sat / showable : 0,
        };
      })
      .filter(s => s.totalBooked > 0)
      .sort((a, b) => b.totalBooked - a.totalBooked)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  })();

  const maxBooked = Math.max(...displaySetters.map(s => s.totalBooked), 1);

  const periodLabel = (() => {
    if (selectedPeriod === 'ytd') return 'YTD';
    if (isWeekKey(selectedPeriod)) {
      if (selectedPeriod === currentWeekKey) return 'This Week';
      return data?.weeks.find(w => w.key === selectedPeriod)?.label ?? selectedPeriod;
    }
    return data?.months.find(m => m.key === selectedPeriod)?.label ?? selectedPeriod;
  })();

  const periodTotal = displaySetters.reduce((s, c) => s + c.totalBooked, 0);
  const periodSat = displaySetters.reduce((s, c) => s + c.sat, 0);
  const periodNoshow = displaySetters.reduce((s, c) => s + c.noshow, 0);
  const teamShowRate =
    periodSat + periodNoshow > 0 ? periodSat / (periodSat + periodNoshow) : 0;

  const topSetter = displaySetters[0];

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: 'var(--bg-primary)' }}
      >
        <div
          className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--gold)', borderTopColor: 'transparent' }}
        />
        <p style={{ color: 'var(--text-muted)' }} className="text-sm tracking-widest uppercase">
          Loading Setter Data…
        </p>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: 'var(--bg-primary)' }}
      >
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => fetchData(true)}
          className="px-6 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: 'var(--gold)', color: '#000' }}
        >
          Try Again
        </button>
      </div>
    );
  }

  // ── Main dashboard ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        style={{
          background: 'linear-gradient(180deg, #0D1C32 0%, #07101E 100%)',
          borderBottom: '2px solid var(--gold)',
        }}
      >
        <div
          style={{ maxWidth: 1200 }}
          className="mx-auto px-4 sm:px-6 py-5 flex items-center justify-between gap-4"
        >
          <div>
            <div className="flex items-center gap-3 mb-1">
              <CalendarIcon />
              <h1
                className="text-xl sm:text-2xl font-black tracking-widest uppercase gold-text"
                style={{ letterSpacing: '0.12em' }}
              >
                Scotian Heat Pumps
              </h1>
            </div>
            <p
              className="text-xs uppercase tracking-widest"
              style={{ color: 'var(--text-muted)', paddingLeft: 44 }}
            >
              Setter Performance Dashboard
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {data && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Updated {fmtDate(data.updatedAt)} at {fmtTime(data.updatedAt)}
              </p>
            )}
            <p className="text-xs" style={{ color: 'var(--gold)' }}>
              {refreshing
                ? 'Refreshing…'
                : `Auto-refresh in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`}
            </p>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="text-xs px-3 py-1.5 rounded-md font-medium transition-all hover:opacity-80"
                style={{
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-card)',
                }}
              >
                ← Sales Board
              </Link>
              <button
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="text-xs px-3 py-1.5 rounded-md font-medium transition-all hover:opacity-80 disabled:opacity-40"
                style={{
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-card)',
                }}
              >
                {refreshing ? '↻ Refreshing…' : '↻ Refresh Now'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200 }} className="mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* ── Demo banner ─────────────────────────────────────────────────── */}
        {data?.isDemo && (
          <div
            className="rounded-lg px-4 py-3 text-sm flex items-center gap-3"
            style={{
              background: 'rgba(234,179,8,0.08)',
              border: '1px solid rgba(234,179,8,0.3)',
              color: '#EAB308',
            }}
          >
            <span className="font-bold shrink-0">Demo Mode</span>
            <span style={{ color: 'var(--text-muted)' }}>
              Add your RepCard API key to <code className="text-xs px-1 py-0.5 rounded" style={{ background: 'var(--bg-secondary)' }}>REPCARD_API_KEY</code> in <code className="text-xs px-1 py-0.5 rounded" style={{ background: 'var(--bg-secondary)' }}>.env.local</code> to see live data.
            </span>
          </div>
        )}

        {/* ── Summary cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label={`Appointments Set (${periodLabel})`} value={String(periodTotal)} gold />
          <StatCard label={`Shows (${periodLabel})`} value={String(periodSat)} />
          <StatCard
            label={`Team Show Rate (${periodLabel})`}
            value={fmtPct(teamShowRate)}
            sub="shows ÷ (shows + no-shows)"
          />
          <StatCard
            label={`${periodLabel} Top Setter`}
            value={topSetter?.name ?? '—'}
            sub={topSetter ? `${topSetter.totalBooked} appts · ${fmtPct(topSetter.showRate)} show` : undefined}
          />
        </div>

        {/* ── Period tabs ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          <Tab active={selectedPeriod === 'ytd'} onClick={() => setSelectedPeriod('ytd')}>
            📊 YTD
          </Tab>
          <Tab
            active={selectedPeriod === currentWeekKey}
            onClick={() => setSelectedPeriod(currentWeekKey)}
          >
            📅 This Week
          </Tab>
          {data?.months.map(m => (
            <Tab
              key={m.key}
              active={selectedPeriod === m.key}
              onClick={() => setSelectedPeriod(m.key)}
            >
              {m.label}
            </Tab>
          ))}
        </div>

        {/* ── Setter table ─────────────────────────────────────────────────── */}
        <section
          className="rounded-xl overflow-hidden gold-border-glow"
          style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
        >
          <div
            className="px-5 sm:px-6 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <h2
              className="font-bold text-sm sm:text-base uppercase tracking-widest"
              style={{ color: 'var(--gold)' }}
            >
              {selectedPeriod === 'ytd'
                ? 'Year-to-Date Setter Leaderboard'
                : (data?.months.find(m => m.key === selectedPeriod)?.label ?? periodLabel) +
                  ' Setter Leaderboard'}
            </h2>
            {displaySetters.length > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                {displaySetters.length} setter{displaySetters.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {displaySetters.length === 0 ? (
            <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>
              No data for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <TH>Rank</TH>
                    <TH>Setter</TH>
                    <TH>Appointments</TH>
                    <TH>Shows</TH>
                    <TH>No-Shows</TH>
                    <TH>Cancels</TH>
                    {displaySetters[0]?.pending > 0 && <TH>Pending</TH>}
                    <TH>Show Rate</TH>
                  </tr>
                </thead>
                <tbody>
                  {displaySetters.map((s, idx) => {
                    const isFirst = idx === 0;
                    const srStyle = showRateStyle(s.showRate);
                    const barPct = (s.totalBooked / maxBooked) * 100;
                    return (
                      <tr
                        key={s.name}
                        style={{
                          borderBottom:
                            idx < displaySetters.length - 1
                              ? '1px solid var(--border)'
                              : 'none',
                          background: isFirst ? 'rgba(201,168,76,0.04)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e =>
                          (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')
                        }
                        onMouseLeave={e =>
                          (e.currentTarget.style.background = isFirst
                            ? 'rgba(201,168,76,0.04)'
                            : 'transparent')
                        }
                      >
                        {/* Rank */}
                        <TD>
                          {idx < 3 ? (
                            <span className="text-2xl leading-none">{MEDALS[idx]}</span>
                          ) : (
                            <span
                              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold"
                              style={{
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              {idx + 1}
                            </span>
                          )}
                        </TD>

                        {/* Setter name + bar */}
                        <TD>
                          <div>
                            <p className="font-semibold text-white text-sm sm:text-base">
                              {s.name}
                            </p>
                            <div
                              className="mt-2 h-1.5 rounded-full overflow-hidden"
                              style={{ background: 'var(--bg-secondary)', width: 140 }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${barPct}%`,
                                  background: isFirst
                                    ? 'linear-gradient(90deg, #C9A84C, #F5D060)'
                                    : 'var(--blue-accent)',
                                  transition: 'width 0.6s ease',
                                }}
                              />
                            </div>
                          </div>
                        </TD>

                        {/* Total booked */}
                        <TD>
                          <span
                            className={`font-bold text-base sm:text-lg ${isFirst ? 'gold-text' : 'text-white'}`}
                          >
                            {s.totalBooked}
                          </span>
                        </TD>

                        {/* Shows */}
                        <TD>
                          <span className="font-semibold" style={{ color: '#22C55E' }}>
                            {s.sat}
                          </span>
                        </TD>

                        {/* No-shows */}
                        <TD>
                          <span style={{ color: '#EF4444' }}>{s.noshow}</span>
                        </TD>

                        {/* Cancels */}
                        <TD>
                          <span style={{ color: 'var(--text-muted)' }}>{s.cancel}</span>
                        </TD>

                        {/* Pending (only if any setter has pending) */}
                        {displaySetters[0]?.pending > 0 && (
                          <TD>
                            <span style={{ color: 'var(--text-muted)' }}>{s.pending}</span>
                          </TD>
                        )}

                        {/* Show rate */}
                        <TD>
                          <span
                            className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
                            style={{ background: srStyle.bg, color: srStyle.color }}
                          >
                            {s.sat + s.noshow > 0 ? fmtPct(s.showRate) : '—'}
                          </span>
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Monthly breakdown ────────────────────────────────────────────── */}
        {selectedPeriod === 'ytd' && data && data.months.length > 0 && (
          <section>
            <h2
              className="font-bold text-sm uppercase tracking-widest mb-4"
              style={{ color: 'var(--gold)' }}
            >
              Monthly Breakdown
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.months.map(month => {
                const entries = data.setters
                  .map(s => ({
                    name: s.name,
                    sat: s.monthly[month.key]?.sat ?? 0,
                    noshow: s.monthly[month.key]?.noshow ?? 0,
                    cancel: s.monthly[month.key]?.cancel ?? 0,
                    pending: s.monthly[month.key]?.pending ?? 0,
                    total:
                      (s.monthly[month.key]?.sat ?? 0) +
                      (s.monthly[month.key]?.noshow ?? 0) +
                      (s.monthly[month.key]?.cancel ?? 0) +
                      (s.monthly[month.key]?.pending ?? 0),
                  }))
                  .filter(e => e.total > 0)
                  .sort((a, b) => b.total - a.total);

                if (entries.length === 0) return null;
                const monthMax = entries[0].total;
                const monthTotal = entries.reduce((s, e) => s + e.total, 0);
                const monthSat = entries.reduce((s, e) => s + e.sat, 0);
                const monthShowable = entries.reduce((s, e) => s + e.sat + e.noshow, 0);
                const monthShowRate = monthShowable > 0 ? monthSat / monthShowable : 0;

                return (
                  <div
                    key={month.key}
                    className="rounded-xl p-5"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3
                        className="font-bold text-xs uppercase tracking-wider"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {month.label}
                      </h3>
                      <span className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>
                        {monthTotal} appts
                      </span>
                    </div>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                      {fmtPct(monthShowRate)} show rate
                    </p>
                    <div className="space-y-3">
                      {entries.map((e, i) => (
                        <div key={e.name}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="flex items-center gap-1.5 text-white font-medium">
                              {i < 3 && <span>{MEDALS[i]}</span>}
                              {e.name}
                            </span>
                            <span
                              style={{ color: i === 0 ? 'var(--gold)' : 'var(--text-muted)' }}
                            >
                              {e.total}a · {e.sat}s
                            </span>
                          </div>
                          <div
                            className="h-1 rounded-full overflow-hidden"
                            style={{ background: 'var(--bg-secondary)' }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(e.total / monthMax) * 100}%`,
                                background:
                                  i === 0
                                    ? 'linear-gradient(90deg, #C9A84C, #F5D060)'
                                    : 'var(--blue-accent)',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Weekly breakdown ─────────────────────────────────────────────── */}
        {(selectedPeriod === 'ytd' || isWeekKey(selectedPeriod)) &&
          data &&
          data.weeks.length > 0 && (
            <section>
              <h2
                className="font-bold text-sm uppercase tracking-widest mb-4"
                style={{ color: 'var(--gold)' }}
              >
                Weekly Breakdown
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {data.weeks.map(week => {
                  const entries = data.setters
                    .map(s => ({
                      name: s.name,
                      sat: s.weekly[week.key]?.sat ?? 0,
                      noshow: s.weekly[week.key]?.noshow ?? 0,
                      cancel: s.weekly[week.key]?.cancel ?? 0,
                      total:
                        (s.weekly[week.key]?.sat ?? 0) +
                        (s.weekly[week.key]?.noshow ?? 0) +
                        (s.weekly[week.key]?.cancel ?? 0) +
                        (s.weekly[week.key]?.pending ?? 0),
                    }))
                    .filter(e => e.total > 0)
                    .sort((a, b) => b.total - a.total);

                  if (entries.length === 0) return null;
                  const weekMax = entries[0].total;
                  const weekTotal = entries.reduce((s, e) => s + e.total, 0);
                  const weekSat = entries.reduce((s, e) => s + e.sat, 0);
                  const weekShowable = entries.reduce((s, e) => s + e.sat + e.noshow, 0);
                  const weekShowRate = weekShowable > 0 ? weekSat / weekShowable : 0;
                  const isCurrentWeek = week.key === currentWeekKey;
                  const isSelected = selectedPeriod === week.key;

                  return (
                    <button
                      key={week.key}
                      onClick={() => setSelectedPeriod(isSelected ? 'ytd' : week.key)}
                      className="rounded-xl p-4 text-left w-full transition-all"
                      style={{
                        background: isSelected ? 'rgba(201,168,76,0.08)' : 'var(--bg-card)',
                        border: isSelected
                          ? '1px solid var(--gold)'
                          : '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {isCurrentWeek && (
                          <span
                            className="text-xs font-bold px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--gold)', color: '#000' }}
                          >
                            This Week
                          </span>
                        )}
                        <h3
                          className="font-bold text-xs uppercase tracking-wider leading-tight"
                          style={{ color: isSelected ? 'var(--gold)' : 'var(--text-muted)' }}
                        >
                          {week.label}
                        </h3>
                      </div>

                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-base font-black" style={{ color: 'var(--gold)' }}>
                          {weekTotal}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          appt{weekTotal !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                        {fmtPct(weekShowRate)} show rate
                      </p>

                      <div className="space-y-2.5">
                        {entries.map((e, i) => (
                          <div key={e.name}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="flex items-center gap-1 text-white font-medium truncate">
                                {i < 3 && <span>{MEDALS[i]}</span>}
                                <span className="truncate">{e.name.split(' ')[0]}</span>
                              </span>
                              <span
                                style={{
                                  color: i === 0 ? 'var(--gold)' : 'var(--text-muted)',
                                }}
                                className="shrink-0 ml-1"
                              >
                                {e.total}
                              </span>
                            </div>
                            <div
                              className="h-1 rounded-full overflow-hidden"
                              style={{ background: 'var(--bg-secondary)' }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${(e.total / weekMax) * 100}%`,
                                  background:
                                    i === 0
                                      ? 'linear-gradient(90deg, #C9A84C, #F5D060)'
                                      : 'var(--blue-accent)',
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {isSelected && (
                        <p
                          className="text-xs mt-3 text-center"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Click to deselect
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

        {/* ── Top setter spotlight ─────────────────────────────────────────── */}
        {selectedPeriod === 'ytd' && topSetter && (
          <section
            className="rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            style={{
              background:
                'linear-gradient(135deg, rgba(201,168,76,0.08) 0%, rgba(201,168,76,0.02) 100%)',
              border: '1px solid rgba(201,168,76,0.3)',
            }}
          >
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--gold)' }}>
                🏆 YTD Top Setter
              </p>
              <p className="text-2xl font-black text-white">{topSetter.name}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                {topSetter.sat} shows · {topSetter.noshow} no-shows ·{' '}
                {fmtPct(topSetter.showRate)} show rate
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black gold-text">{topSetter.totalBooked}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Total appointments YTD
              </p>
            </div>
          </section>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="text-center pb-4">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {data?.isDemo
              ? 'Demo data · connect RepCard to see live stats'
              : 'Live data · synced from RepCard every 5 minutes'}
          </p>
          {error && (
            <p className="text-xs text-red-400 mt-1">
              ⚠ Last refresh failed — showing cached data
            </p>
          )}
        </footer>
      </main>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CalendarIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="18" height="17" rx="2" stroke="url(#cal-grad)" strokeWidth="2" fill="none" />
      <path d="M3 9h18" stroke="url(#cal-grad)" strokeWidth="2" />
      <path d="M8 2v4M16 2v4" stroke="url(#cal-grad)" strokeWidth="2" strokeLinecap="round" />
      <rect x="7" y="13" width="3" height="3" rx="0.5" fill="url(#cal-grad)" />
      <rect x="11" y="13" width="3" height="3" rx="0.5" fill="url(#cal-grad)" />
      <defs>
        <linearGradient id="cal-grad" x1="3" y1="2" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F5D060" />
          <stop offset="100%" stopColor="#C9A84C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function StatCard({
  label,
  value,
  sub,
  gold,
}: {
  label: string;
  value: string;
  sub?: string;
  gold?: boolean;
}) {
  return (
    <div
      className="rounded-xl p-4 sm:p-5"
      style={{
        background: 'var(--bg-card)',
        border: gold ? '1px solid rgba(201,168,76,0.4)' : '1px solid var(--border)',
        boxShadow: gold ? '0 0 20px rgba(201,168,76,0.08)' : 'none',
      }}
    >
      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className={`text-2xl sm:text-3xl font-black ${gold ? 'gold-text' : 'text-white'}`}>
        {value}
      </p>
      {sub && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all"
      style={{
        background: active ? 'var(--gold)' : 'var(--bg-card)',
        color: active ? '#000' : 'var(--text-muted)',
        border: active ? '1px solid var(--gold)' : '1px solid var(--border)',
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

function TH({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-4 sm:px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </th>
  );
}

function TD({ children }: { children: React.ReactNode }) {
  return <td className="px-4 sm:px-6 py-4 whitespace-nowrap">{children}</td>;
}
