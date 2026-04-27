'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface MonthStats {
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
  monthly: Record<string, MonthStats>;
}

interface ApiResponse {
  leaderboard: CloserStats[];
  totalRevenue: number;
  totalDeals: number;
  months: { key: string; label: string }[];
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

  // ── Compute display data based on selected tab ───────────────────────────
  const displayData: CloserStats[] = (() => {
    if (!data) return [];
    if (selectedMonth === 'ytd') return data.leaderboard;
    return data.leaderboard
      .map(c => ({
        ...c,
        revenue: c.monthly[selectedMonth]?.revenue ?? 0,
        deals: c.monthly[selectedMonth]?.deals ?? 0,
      }))
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .map((c, i) => ({ ...c, rank: i + 1 }));
  })();

  const maxRevenue = Math.max(...displayData.map(c => c.revenue), 1);

  const currentMonthRevenue = data?.months[0]
    ? data.leaderboard.reduce((s, c) => s + (c.monthly[data.months[0].key]?.revenue ?? 0), 0)
    : 0;

  const avgCloseRate =
    data && data.leaderboard.length > 0
      ? data.leaderboard.reduce((s, c) => s + c.closeRatePerSit, 0) / data.leaderboard.filter(c => c.sits > 0).length
      : 0;

  const topPerformer = data?.leaderboard[0];

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
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard label="Total Revenue (YTD)" value={fmt$(data?.totalRevenue ?? 0)} gold />
          <StatCard label="Deals Closed (YTD)" value={String(data?.totalDeals ?? 0)} />
          <StatCard
            label={data?.months[0] ? `${data.months[0].label} Revenue` : 'This Month'}
            value={fmt$(currentMonthRevenue)}
          />
          <StatCard
            label="Team Avg Close Rate"
            value={fmtPct(avgCloseRate)}
            sub="per sit"
          />
        </div>

        {/* ── Month tabs ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2">
          <Tab active={selectedMonth === 'ytd'} onClick={() => setSelectedMonth('ytd')}>
            📊 YTD
          </Tab>
          {data?.months.map(m => (
            <Tab key={m.key} active={selectedMonth === m.key} onClick={() => setSelectedMonth(m.key)}>
              {m.label}
            </Tab>
          ))}
        </div>

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
              {selectedMonth === 'ytd'
                ? 'Year-to-Date Leaderboard'
                : (data?.months.find(m => m.key === selectedMonth)?.label ?? '') + ' Leaderboard'}
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
                    const crStyle = closeRateStyle(c.closeRatePerSit);
                    const barPct = (c.revenue / maxRevenue) * 100;
                    return (
                      <tr
                        key={c.name}
                        style={{
                          borderBottom: idx < displayData.length - 1 ? '1px solid var(--border)' : 'none',
                          background: isFirst ? 'rgba(201,168,76,0.04)' : 'transparent',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                        onMouseLeave={e => (e.currentTarget.style.background = isFirst ? 'rgba(201,168,76,0.04)' : 'transparent')}
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
