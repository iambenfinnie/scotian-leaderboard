'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface PeriodStats {
  revenue: number;
  deals: number;
}

interface CloserStats {
  rank: number;
  name: string;
  revenue: number;
  deals: number;
  leads: number;
  sits: number;
  closeRatePerLead: number;
  closeRatePerSit: number;
  revenuePerSit: number;
  monthly: Record<string, PeriodStats>;
  weekly: Record<string, PeriodStats>;
}

interface ApiResponse {
  leaderboard: CloserStats[];
  totalRevenue: number;
  totalDeals: number;
  months: { key: string; label: string }[];
  weeks: { key: string; label: string }[];
  updatedAt: string;
  error?: string;
}

const REFRESH_SECONDS = 300;

const MEDALS = ['🥇', '🥈', '🥉'];

function fmt$(n: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtPct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

// Returns the YYYY-MM-DD of the Monday that starts the current week
function getCurrentWeekKey(): string {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
}

function getCurrentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isWeekKey(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-CA', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Color coding for close rate ──────────────────────────────────────────────
function closeRateStyle(rate: number) {
  if (rate >= 0.4) return { bg: 'rgba(34,197,94,0.15)', color: '#22C55E' };
  if (rate >= 0.25) return { bg: 'rgba(234,179,8,0.15)', color: '#EAB308' };
  return { bg: 'rgba(239,68,68,0.1)', color: '#EF4444' };
}

export default function LeaderboardPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>('ytd');
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [refreshing, setRefreshing] = useState(false);
  const [showPastMonths, setShowPastMonths] = useState(false);
  const [showPastWeeks, setShowPastWeeks] = useState(false);
  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const countdownRef = useRef(REFRESH_SECONDS);

  const fetchData = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/api/leaderboard');
      if (!res.ok) throw new Error('Bad response');
      const json: ApiResponse = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setError(null);
      countdownRef.current = REFRESH_SECONDS;
      setCountdown(REFRESH_SECONDS);
    } catch {
      setError('Could not reach the leaderboard. Check your connection and try again.');
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
      if (countdownRef.current <= 0) {
        fetchData();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const currentWeekKey = getCurrentWeekKey();
  const currentMonthKey = getCurrentMonthKey();
  const lastYear = new Date().getFullYear() - 1;

  // ── Compute display data based on selected tab ───────────────────────────
  const displayData: CloserStats[] = (() => {
    if (!data) return [];
    if (selectedMonth === 'ytd') return data.leaderboard;
    if (selectedMonth === 'last-year') {
      const prefix = `${lastYear}-`;
      return data.leaderboard
        .map(c => ({
          ...c,
          revenue: Object.entries(c.monthly)
            .filter(([k]) => k.startsWith(prefix))
            .reduce((s, [, v]) => s + v.revenue, 0),
          deals: Object.entries(c.monthly)
            .filter(([k]) => k.startsWith(prefix))
            .reduce((s, [, v]) => s + v.deals, 0),
        }))
        .filter(c => c.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .map((c, i) => ({ ...c, rank: i + 1 }));
    }
    const periodMap = isWeekKey(selectedMonth) ? 'weekly' : 'monthly';
    return data.leaderboard
      .map(c => ({
        ...c,
        revenue: c[periodMap][selectedMonth]?.revenue ?? 0,
        deals: c[periodMap][selectedMonth]?.deals ?? 0,
      }))
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .map((c, i) => ({ ...c, rank: i + 1 }));
  })();

  const maxRevenue = Math.max(...displayData.map(c => c.revenue), 1);

  const periodLabel = (() => {
    if (selectedMonth === 'ytd') return 'YTD';
    if (selectedMonth === 'last-year') return `${lastYear}`;
    if (isWeekKey(selectedMonth)) {
      if (selectedMonth === currentWeekKey) return 'This Week';
      return data?.weeks.find(w => w.key === selectedMonth)?.label ?? selectedMonth;
    }
    if (selectedMonth === currentMonthKey) return 'This Month';
    return data?.months.find(m => m.key === selectedMonth)?.label ?? selectedMonth;
  })();

  const periodRevenue = displayData.reduce((s, c) => s + c.revenue, 0);
  const periodDeals = displayData.reduce((s, c) => s + c.deals, 0);

  // Current month (most recent) for the YTD "this month" card
  const currentMonthRevenue = data?.months[0]
    ? data.leaderboard.reduce((s, c) => s + (c.monthly[data.months[0].key]?.revenue ?? 0), 0)
    : 0;

  const avgCloseRate =
    data && data.leaderboard.length > 0
      ? data.leaderboard.reduce((s, c) => s + c.closeRatePerSit, 0) / data.leaderboard.filter(c => c.sits > 0).length
      : 0;

  const topPerformer = data?.leaderboard[0];

  // Selected rep data (period + YTD)
  const selectedRepPeriod = selectedRep ? displayData.find(c => c.name === selectedRep) : null;
  const selectedRepYTD = selectedRep ? data?.leaderboard.find(c => c.name === selectedRep) : null;

  // ── Loading screen ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg-primary)' }}>
        <div
          className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
          style={{ borderColor: 'var(--gold)', borderTopColor: 'transparent' }}
        />
        <p style={{ color: 'var(--text-muted)' }} className="text-sm tracking-widest uppercase">
          Loading Leaderboard…
        </p>
      </div>
    );
  }

  // ── Error screen ─────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: 'var(--bg-primary)' }}>
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

  // ── Main dashboard ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        style={{
          background: 'linear-gradient(180deg, #0D1C32 0%, #07101E 100%)',
          borderBottom: '2px solid var(--gold)',
        }}
      >
        <div style={{ maxWidth: 1200 }} className="mx-auto px-4 sm:px-6 py-5 flex items-center justify-between gap-4">
          <div>
            {/* Flame icon + wordmark */}
            <div className="flex items-center gap-3 mb-1">
              <FlameIcon />
              <h1
                className="text-xl sm:text-2xl font-black tracking-widest uppercase gold-text"
                style={{ letterSpacing: '0.12em' }}
              >
                Scotian Heat Pumps
              </h1>
            </div>
            <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-muted)', paddingLeft: 44 }}>
              Sales Performance Dashboard
            </p>
          </div>

          {/* Right: refresh status */}
          <div className="text-right shrink-0">
            {data && (
              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                Updated {fmtDate(data.updatedAt)} at {fmtTime(data.updatedAt)}
              </p>
            )}
            <p className="text-xs mb-2" style={{ color: 'var(--gold)' }}>
              {refreshing
                ? 'Refreshing…'
                : `Auto-refresh in ${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`}
            </p>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="text-xs px-3 py-1.5 rounded-md font-medium transition-all hover:opacity-80 disabled:opacity-40"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}
            >
              {refreshing ? '↻ Refreshing…' : '↻ Refresh Now'}
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200 }} className="mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* ── Summary cards ───────────────────────────────────────────────── */}
        {selectedRep && selectedRepYTD ? (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--gold)' }}>
                {selectedRep} — {periodLabel}
              </p>
              <button
                onClick={() => setSelectedRep(null)}
                className="text-xs px-3 py-1 rounded-md transition-opacity hover:opacity-70"
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'var(--bg-card)' }}
              >
                ✕ All Closers
              </button>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <StatCard label={`Revenue (${periodLabel})`} value={fmt$(selectedRepPeriod?.revenue ?? 0)} gold />
              <StatCard label={`Deals (${periodLabel})`} value={String(selectedRepPeriod?.deals ?? 0)} />
              <StatCard
                label="Close Rate / Sit (YTD)"
                value={fmtPct(selectedRepYTD.closeRatePerSit)}
                sub={`${selectedRepYTD.sits} sits YTD`}
              />
              <StatCard
                label="Revenue / Sit (YTD)"
                value={fmt$(selectedRepYTD.revenuePerSit)}
                sub={`${selectedRepYTD.deals} deals YTD`}
              />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label={`Total Revenue (${periodLabel})`} value={fmt$(periodRevenue)} gold />
            <StatCard label={`Deals Closed (${periodLabel})`} value={String(periodDeals)} />
            {selectedMonth === 'ytd' ? (
              <StatCard label="This Month Revenue" value={fmt$(currentMonthRevenue)} />
            ) : (
              <StatCard
                label={`${periodLabel} — Top Closer`}
                value={displayData[0]?.name ?? '—'}
                sub={displayData[0] ? fmt$(displayData[0].revenue) : undefined}
              />
            )}
            <StatCard
              label={selectedMonth === 'ytd' ? 'Team Avg Close Rate' : 'Team Avg Close Rate (YTD)'}
              value={fmtPct(avgCloseRate)}
              sub="per sit"
            />
          </div>
        )}

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 items-center">

          {/* YTD / past years split button */}
          <div className="relative">
            <div
              className="flex items-stretch rounded-lg overflow-hidden"
              style={{ border: selectedMonth === 'ytd' || selectedMonth === 'last-year' ? '1px solid var(--gold)' : '1px solid var(--border)' }}
            >
              <button
                onClick={() => { setSelectedMonth('ytd'); setShowPastMonths(false); setShowPastWeeks(false); setShowYearDropdown(false); }}
                className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all"
                style={{
                  background: selectedMonth === 'ytd' || selectedMonth === 'last-year' ? 'rgba(201,168,76,0.1)' : 'var(--bg-card)',
                  color: selectedMonth === 'ytd' || selectedMonth === 'last-year' ? 'var(--gold)' : 'var(--text-muted)',
                  fontWeight: selectedMonth === 'ytd' || selectedMonth === 'last-year' ? 700 : 500,
                }}
              >
                📊 {selectedMonth === 'last-year' ? lastYear : 'YTD'}
              </button>
              <button
                onClick={() => { setShowYearDropdown(p => !p); setShowPastMonths(false); setShowPastWeeks(false); }}
                className="px-2 py-1.5 text-xs transition-all"
                style={{
                  background: showYearDropdown ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.05)',
                  color: 'var(--text-muted)',
                  borderLeft: '1px solid var(--border)',
                }}
              >
                {showYearDropdown ? '▲' : '▾'}
              </button>
            </div>
            {showYearDropdown && (
              <div
                className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-20 min-w-max"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
              >
                <button
                  onClick={() => { setSelectedMonth('ytd'); setShowYearDropdown(false); }}
                  className="block w-full text-left px-4 py-2.5 text-sm"
                  style={{
                    background: selectedMonth === 'ytd' ? 'rgba(201,168,76,0.1)' : 'transparent',
                    color: selectedMonth === 'ytd' ? 'var(--gold)' : 'var(--text-muted)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = selectedMonth === 'ytd' ? 'rgba(201,168,76,0.1)' : 'transparent')}
                >
                  {new Date().getFullYear()} (YTD)
                </button>
                <button
                  onClick={() => { setSelectedMonth('last-year'); setShowYearDropdown(false); }}
                  className="block w-full text-left px-4 py-2.5 text-sm"
                  style={{
                    background: selectedMonth === 'last-year' ? 'rgba(201,168,76,0.1)' : 'transparent',
                    color: selectedMonth === 'last-year' ? 'var(--gold)' : 'var(--text-muted)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = selectedMonth === 'last-year' ? 'rgba(201,168,76,0.1)' : 'transparent')}
                >
                  {lastYear}
                </button>
              </div>
            )}
          </div>

          {/* This Month + previous months dropdown */}
          {data && data.months.length > 0 && (
            <div className="relative">
              <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: selectedMonth === currentMonthKey || data.months.slice(1).some(m => m.key === selectedMonth) ? '1px solid var(--gold)' : '1px solid var(--border)' }}>
                {/* Main: selects This Month */}
                <button
                  onClick={() => { setSelectedMonth(currentMonthKey); setShowPastMonths(false); setShowPastWeeks(false); }}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all"
                  style={{
                    background: selectedMonth === currentMonthKey || data.months.slice(1).some(m => m.key === selectedMonth) ? 'rgba(201,168,76,0.1)' : 'var(--bg-card)',
                    color: selectedMonth === currentMonthKey ? 'var(--gold)' : data.months.slice(1).some(m => m.key === selectedMonth) ? 'var(--gold)' : 'var(--text-muted)',
                    fontWeight: selectedMonth === currentMonthKey || data.months.slice(1).some(m => m.key === selectedMonth) ? 700 : 500,
                  }}
                >
                  📆 {data.months.slice(1).find(m => m.key === selectedMonth)?.label ?? 'This Month'}
                </button>
                {/* Chevron: opens past months */}
                {data.months.length > 1 && (
                  <button
                    onClick={() => { setShowPastMonths(p => !p); setShowPastWeeks(false); }}
                    className="px-2 py-1.5 text-xs transition-all"
                    style={{
                      background: showPastMonths ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.05)',
                      color: 'var(--text-muted)',
                      borderLeft: '1px solid var(--border)',
                    }}
                  >
                    {showPastMonths ? '▲' : '▾'}
                  </button>
                )}
              </div>
              {showPastMonths && (
                <div
                  className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-20 min-w-max"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
                >
                  {data.months.slice(1).map(m => (
                    <button
                      key={m.key}
                      onClick={() => { setSelectedMonth(m.key); setShowPastMonths(false); }}
                      className="block w-full text-left px-4 py-2.5 text-sm"
                      style={{
                        background: selectedMonth === m.key ? 'rgba(201,168,76,0.1)' : 'transparent',
                        color: selectedMonth === m.key ? 'var(--gold)' : 'var(--text-muted)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = selectedMonth === m.key ? 'rgba(201,168,76,0.1)' : 'transparent')}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* This Week + previous weeks dropdown */}
          {data && data.weeks.length > 0 && (
            <div className="relative">
              <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: isWeekKey(selectedMonth) ? '1px solid var(--gold)' : '1px solid var(--border)' }}>
                {/* Main: selects This Week */}
                <button
                  onClick={() => { setSelectedMonth(currentWeekKey); setShowPastWeeks(false); setShowPastMonths(false); }}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all"
                  style={{
                    background: isWeekKey(selectedMonth) ? 'rgba(201,168,76,0.1)' : 'var(--bg-card)',
                    color: isWeekKey(selectedMonth) ? 'var(--gold)' : 'var(--text-muted)',
                    fontWeight: isWeekKey(selectedMonth) ? 700 : 500,
                  }}
                >
                  📅 {data.weeks.find(w => w.key === selectedMonth)?.label ?? 'This Week'}
                </button>
                {/* Chevron: opens past weeks */}
                {data.weeks.length > 1 && (
                  <button
                    onClick={() => { setShowPastWeeks(p => !p); setShowPastMonths(false); }}
                    className="px-2 py-1.5 text-xs transition-all"
                    style={{
                      background: showPastWeeks ? 'rgba(201,168,76,0.2)' : 'rgba(201,168,76,0.05)',
                      color: 'var(--text-muted)',
                      borderLeft: '1px solid var(--border)',
                    }}
                  >
                    {showPastWeeks ? '▲' : '▾'}
                  </button>
                )}
              </div>
              {showPastWeeks && (
                <div
                  className="absolute top-full left-0 mt-1 rounded-xl overflow-hidden z-20 min-w-max"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
                >
                  {data.weeks.slice(1).map(w => (
                    <button
                      key={w.key}
                      onClick={() => { setSelectedMonth(w.key); setShowPastWeeks(false); }}
                      className="block w-full text-left px-4 py-2.5 text-sm"
                      style={{
                        background: selectedMonth === w.key ? 'rgba(201,168,76,0.1)' : 'transparent',
                        color: selectedMonth === w.key ? 'var(--gold)' : 'var(--text-muted)',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                      onMouseLeave={e => (e.currentTarget.style.background = selectedMonth === w.key ? 'rgba(201,168,76,0.1)' : 'transparent')}
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* ── Rep filter pills ────────────────────────────────────────────── */}
        {data && data.leaderboard.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Filter:
            </span>
            <button
              onClick={() => setSelectedRep(null)}
              className="px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={{
                background: !selectedRep ? 'var(--gold)' : 'var(--bg-card)',
                color: !selectedRep ? '#000' : 'var(--text-muted)',
                border: !selectedRep ? '1px solid var(--gold)' : '1px solid var(--border)',
                fontWeight: !selectedRep ? 700 : 500,
              }}
            >
              All Closers
            </button>
            {data.leaderboard.map(c => (
              <button
                key={c.name}
                onClick={() => setSelectedRep(selectedRep === c.name ? null : c.name)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  background: selectedRep === c.name ? 'var(--gold)' : 'var(--bg-card)',
                  color: selectedRep === c.name ? '#000' : 'var(--text-muted)',
                  border: selectedRep === c.name ? '1px solid var(--gold)' : '1px solid var(--border)',
                  fontWeight: selectedRep === c.name ? 700 : 500,
                }}
              >
                {c.name.split(' ')[0]}
              </button>
            ))}
          </div>
        )}

        {/* ── Leaderboard table ───────────────────────────────────────────── */}
        <section
          className="rounded-xl overflow-hidden gold-border-glow"
          style={{ border: '1px solid var(--border)', background: 'var(--bg-card)' }}
        >
          {/* Table header */}
          <div
            className="px-5 sm:px-6 py-4 flex items-center justify-between"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <h2 className="font-bold text-sm sm:text-base uppercase tracking-widest" style={{ color: 'var(--gold)' }}>
              {periodLabel} Leaderboard
            </h2>
            {displayData.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                {displayData.length} closers
              </span>
            )}
          </div>

          {displayData.length === 0 ? (
            <div className="py-16 text-center" style={{ color: 'var(--text-muted)' }}>
              No data for this period.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <TH>Rank</TH>
                    <TH>Closer</TH>
                    <TH>Revenue</TH>
                    <TH>Deals</TH>
                    {selectedMonth === 'ytd' && (
                      <>
                        <TH>Appointments</TH>
                        <TH>Close Rate / Sit</TH>
                        <TH>Rev / Sit</TH>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayData.map((c, idx) => {
                    const isFirst = idx === 0;
                    const isHighlighted = selectedRep === c.name;
                    const crStyle = closeRateStyle(c.closeRatePerSit);
                    const barPct = (c.revenue / maxRevenue) * 100;
                    return (
                      <tr
                        key={c.name}
                        onClick={() => setSelectedRep(selectedRep === c.name ? null : c.name)}
                        style={{
                          borderBottom: idx < displayData.length - 1 ? '1px solid var(--border)' : 'none',
                          background: isHighlighted
                            ? 'rgba(201,168,76,0.08)'
                            : isFirst ? 'rgba(201,168,76,0.04)' : 'transparent',
                          transition: 'background 0.15s',
                          cursor: 'pointer',
                          boxShadow: isHighlighted ? 'inset 3px 0 0 var(--gold)' : 'none',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                        onMouseLeave={e => (e.currentTarget.style.background = isHighlighted
                          ? 'rgba(201,168,76,0.08)'
                          : isFirst ? 'rgba(201,168,76,0.04)' : 'transparent')}
                      >
                        {/* Rank */}
                        <TD>
                          {idx < 3 ? (
                            <span className="text-2xl leading-none">{MEDALS[idx]}</span>
                          ) : (
                            <span
                              className="inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold"
                              style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
                            >
                              {idx + 1}
                            </span>
                          )}
                        </TD>

                        {/* Closer name + bar */}
                        <TD>
                          <div>
                            <p className="font-semibold text-white text-sm sm:text-base">{c.name}</p>
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

                        {/* Revenue */}
                        <TD>
                          <span
                            className={`font-bold text-base sm:text-lg ${isFirst ? 'gold-text' : 'text-white'}`}
                          >
                            {fmt$(c.revenue)}
                          </span>
                        </TD>

                        {/* Deals */}
                        <TD>
                          <span className="font-semibold text-white">{c.deals}</span>
                        </TD>

                        {selectedMonth === 'ytd' && (
                          <>
                            {/* Appointments */}
                            <TD>
                              <span style={{ color: 'var(--text-muted)' }}>{c.sits}</span>
                            </TD>

                            {/* Close rate */}
                            <TD>
                              <span
                                className="inline-block px-2 py-0.5 rounded text-xs font-semibold"
                                style={{ background: crStyle.bg, color: crStyle.color }}
                              >
                                {fmtPct(c.closeRatePerSit)}
                              </span>
                            </TD>

                            {/* Rev / sit */}
                            <TD>
                              <span style={{ color: 'var(--text-muted)' }} className="text-sm">
                                {fmt$(c.revenuePerSit)}
                              </span>
                            </TD>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Monthly breakdown cards (YTD view only) ─────────────────────── */}
        {selectedMonth === 'ytd' && data && data.months.length > 0 && (
          <section>
            <h2 className="font-bold text-sm uppercase tracking-widest mb-4" style={{ color: 'var(--gold)' }}>
              Monthly Breakdown
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.months.map(month => {
                const entries = data.leaderboard
                  .map(c => ({
                    name: c.name,
                    revenue: c.monthly[month.key]?.revenue ?? 0,
                    deals: c.monthly[month.key]?.deals ?? 0,
                  }))
                  .filter(c => c.revenue > 0)
                  .sort((a, b) => b.revenue - a.revenue);

                if (entries.length === 0) return null;
                const monthMax = entries[0].revenue;
                const monthTotal = entries.reduce((s, c) => s + c.revenue, 0);

                return (
                  <div
                    key={month.key}
                    className="rounded-xl p-5"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-bold text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        {month.label}
                      </h3>
                      <span className="text-xs font-semibold" style={{ color: 'var(--gold)' }}>
                        {fmt$(monthTotal)}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {entries.map((e, i) => (
                        <div key={e.name}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="flex items-center gap-1.5 text-white font-medium">
                              {i < 3 && <span>{MEDALS[i]}</span>}
                              {e.name}
                            </span>
                            <span style={{ color: i === 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
                              {fmt$(e.revenue)} · {e.deals}d
                            </span>
                          </div>
                          <div
                            className="h-1 rounded-full overflow-hidden"
                            style={{ background: 'var(--bg-secondary)' }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(e.revenue / monthMax) * 100}%`,
                                background: i === 0
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
        {(selectedMonth === 'ytd' || isWeekKey(selectedMonth)) && data && data.weeks.length > 0 && (
          <section>
            <h2 className="font-bold text-sm uppercase tracking-widest mb-4" style={{ color: 'var(--gold)' }}>
              Weekly Breakdown
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.weeks.map(week => {
                const entries = data.leaderboard
                  .map(c => ({
                    name: c.name,
                    revenue: c.weekly[week.key]?.revenue ?? 0,
                    deals: c.weekly[week.key]?.deals ?? 0,
                  }))
                  .filter(c => c.revenue > 0)
                  .sort((a, b) => b.revenue - a.revenue);

                if (entries.length === 0) return null;
                const weekMax = entries[0].revenue;
                const weekTotal = entries.reduce((s, c) => s + c.revenue, 0);
                const weekDeals = entries.reduce((s, c) => s + c.deals, 0);
                const isCurrentWeek = week.key === currentWeekKey;
                const isSelected = selectedMonth === week.key;

                return (
                  <button
                    key={week.key}
                    onClick={() => setSelectedMonth(isSelected ? 'ytd' : week.key)}
                    className="rounded-xl p-4 text-left w-full transition-all"
                    style={{
                      background: isSelected ? 'rgba(201,168,76,0.08)' : 'var(--bg-card)',
                      border: isSelected
                        ? '1px solid var(--gold)'
                        : '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    {/* Week label + badges */}
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

                    {/* Week totals */}
                    <div className="flex items-baseline gap-2 mb-3">
                      <span className="text-base font-black" style={{ color: 'var(--gold)' }}>
                        {fmt$(weekTotal)}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {weekDeals} deal{weekDeals !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Per-closer bars */}
                    <div className="space-y-2.5">
                      {entries.map((e, i) => (
                        <div key={e.name}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="flex items-center gap-1 text-white font-medium truncate">
                              {i < 3 && <span>{MEDALS[i]}</span>}
                              <span className="truncate">{e.name.split(' ')[0]}</span>
                            </span>
                            <span
                              style={{ color: i === 0 ? 'var(--gold)' : 'var(--text-muted)' }}
                              className="shrink-0 ml-1"
                            >
                              {fmt$(e.revenue)}
                            </span>
                          </div>
                          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(e.revenue / weekMax) * 100}%`,
                                background: i === 0
                                  ? 'linear-gradient(90deg, #C9A84C, #F5D060)'
                                  : 'var(--blue-accent)',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {isSelected && (
                      <p className="text-xs mt-3 text-center" style={{ color: 'var(--text-muted)' }}>
                        Click to deselect
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Top performer spotlight ──────────────────────────────────────── */}
        {selectedMonth === 'ytd' && topPerformer && (
          <section
            className="rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            style={{
              background: 'linear-gradient(135deg, rgba(201,168,76,0.08) 0%, rgba(201,168,76,0.02) 100%)',
              border: '1px solid rgba(201,168,76,0.3)',
            }}
          >
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--gold)' }}>
                🏆 YTD Top Performer
              </p>
              <p className="text-2xl font-black text-white">{topPerformer.name}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                {topPerformer.deals} deals · {fmtPct(topPerformer.closeRatePerSit)} close rate · {fmt$(topPerformer.revenuePerSit)} / sit
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-black gold-text">{fmt$(topPerformer.revenue)}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Total revenue YTD</p>
            </div>
          </section>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="text-center pb-4">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Live data · synced from Google Sheets every 5 minutes
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

// ── Sub-components ─────────────────────────────────────────────────────────

function FlameIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C12 2 7 7.5 7 13C7 15.76 9.24 18 12 18C14.76 18 17 15.76 17 13C17 10.5 15 8 15 8C15 8 14.5 10 13 10C13 10 14 8 12 2Z"
        fill="url(#flame-grad)"
      />
      <path
        d="M12 22C10.34 22 9 20.66 9 19C9 17.5 10.5 16 12 16C13.5 16 15 17.5 15 19C15 20.66 13.66 22 12 22Z"
        fill="url(#flame-grad-2)"
      />
      <defs>
        <linearGradient id="flame-grad" x1="12" y1="2" x2="12" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F5D060" />
          <stop offset="100%" stopColor="#C9A84C" />
        </linearGradient>
        <linearGradient id="flame-grad-2" x1="12" y1="16" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C9A84C" />
          <stop offset="100%" stopColor="#A07830" />
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
  return (
    <td className="px-4 sm:px-6 py-4 whitespace-nowrap">
      {children}
    </td>
  );
}
