'use client';

import { useEffect, useState, useRef } from 'react';
import { jobs as jobsApi, printers, clients, analytics as analyticsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area
} from 'recharts';
import Link from 'next/link';
import { format } from 'date-fns';

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function PrinterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="7" x2="6.01" y2="7" />
      <line x1="6" y1="17" x2="6.01" y2="17" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ClockIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function ActivityIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20 }}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

// ─── Count-Up Hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(eased * target));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return value;
}

// ─── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  badge,
  badgeColor,
  value,
  total,
  label,
  subtext,
  index = 0,
}: {
  icon: React.ReactNode;
  badge: string;
  badgeColor: 'green' | 'amber' | 'cyan';
  value: number;
  total?: number;
  label: string;
  subtext: React.ReactNode;
  index?: number;
}) {
  const animated = useCountUp(value);
  const pct = total && total > 0 ? (value / total) * 100 : 0;

  const badgeColors: Record<string, React.CSSProperties> = {
    green: { background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.35)', color: '#00ff88' },
    amber: { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#f59e0b' },
    cyan: { background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.35)', color: '#00d4ff' },
  };

  return (
    <div className="stat-card" style={{ '--index': index } as React.CSSProperties}>
      <div className="stat-card-header">
        <div className="stat-icon" style={{ color: 'var(--accent-cyan)' }}>{icon}</div>
        <span className="stat-badge" style={{ ...badgeColors[badgeColor], fontSize: 10, padding: '2px 8px', borderRadius: 4, fontFamily: 'Share Tech Mono', textTransform: 'uppercase' }}>
          {badge}
        </span>
      </div>
      <div className="stat-value" style={{ fontSize: 36, fontWeight: 700, fontFamily: 'Share Tech Mono', color: 'var(--text-primary)', lineHeight: 1 }}>
        {animated}
      </div>
      <div style={{ fontFamily: 'Rajdhani', fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 }}>
        {label}
      </div>
      {total !== undefined && (
        <div className="stat-progress">
          <div className="stat-progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="stat-subtext">{subtext}</div>
    </div>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="stat-card">
      <div className="skeleton-pulse" style={{ height: 20, width: 20, borderRadius: 4, marginBottom: 12 }} />
      <div className="skeleton-pulse" style={{ height: 36, width: 80, borderRadius: 4, marginBottom: 8 }} />
      <div className="skeleton-pulse" style={{ height: 14, width: 100, borderRadius: 4, marginBottom: 12 }} />
      <div className="skeleton-pulse" style={{ height: 4, borderRadius: 2 }} />
    </div>
  );
}

// ─── Live Active Server Nodes ──────────────────────────────────────────────────

function ActiveNodeList({ nodes }: { nodes: any[] }) {
  return (
    <div className="active-nodes-section" style={{
      background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      padding: '20px 24px',
      marginBottom: 28,
      animation: 'fadeInUp 0.6s ease forwards',
      animationDelay: '0.2s',
      opacity: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent-green)' }}>
            <ActivityIcon color="var(--accent-green)" />
          </span>
          <span style={{ fontFamily: 'Rajdhani', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)' }}>
            Live Server Nodes
          </span>
          <span style={{
            background: 'rgba(0,255,136,0.12)',
            border: '1px solid rgba(0,255,136,0.35)',
            color: 'var(--accent-green)',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 4,
            fontFamily: 'Share Tech Mono',
            textTransform: 'uppercase',
            marginLeft: 4,
          }}>
            {nodes.length} ONLINE
          </span>
        </div>
        <span style={{ fontSize: 10, fontFamily: 'Share Tech Mono', color: 'var(--text-muted)' }}>
          Updated {format(new Date(), 'HH:mm:ss')}
        </span>
      </div>

      {nodes.length === 0 ? (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontFamily: 'Rajdhani',
          fontSize: 13,
          border: '1px dashed var(--border)',
          borderRadius: 8,
        }}>
          No active server nodes. Agents will appear here once they send a heartbeat.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 10,
        }}>
          {nodes.map((n: any) => {
            const lastSeenMs = n.last_seen ? new Date(n.last_seen).getTime() : 0;
            const seenAgo = Math.max(0, Math.floor((Date.now() - lastSeenMs) / 1000));
            const stale = !lastSeenMs || seenAgo > 5 * 60;
            // Human-friendly "Xs/Xm/Xh/Xd ago"
            const fmtAgo = (s: number) => {
              if (s < 60) return `${s}s ago`;
              if (s < 3600) return `${Math.floor(s / 60)}m ago`;
              if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
              return `${Math.floor(s / 86400)}d ago`;
            };
            return (
              <Link
                key={n.id}
                href={`/clients/${n.id}`}
                style={{
                  textDecoration: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  background: stale ? 'rgba(255,184,0,0.04)' : 'rgba(0,255,136,0.04)',
                  border: stale ? '1px solid rgba(255,184,0,0.35)' : '1px solid rgba(0,255,136,0.25)',
                  borderRadius: 10,
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = stale ? 'rgba(255,184,0,0.10)' : 'rgba(0,255,136,0.10)';
                  e.currentTarget.style.borderColor = stale ? 'rgba(255,184,0,0.6)' : 'rgba(0,255,136,0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = stale ? 'rgba(255,184,0,0.04)' : 'rgba(0,255,136,0.04)';
                  e.currentTarget.style.borderColor = stale ? 'rgba(255,184,0,0.35)' : 'rgba(0,255,136,0.25)';
                }}
              >
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: stale ? 'var(--accent-amber)' : 'var(--accent-green)',
                  boxShadow: stale ? '0 0 8px var(--accent-amber)' : '0 0 8px var(--accent-green)',
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'Share Tech Mono',
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {n.hostname || `node-${n.id}`}
                  </div>
                  <div style={{
                    fontFamily: 'Share Tech Mono',
                    fontSize: 10,
                    color: stale ? 'var(--accent-amber)' : 'var(--text-muted)',
                    marginTop: 2,
                  }}>
                    {n.ip_address || 'no-ip'} • {n.os_version || 'unknown OS'} • {fmtAgo(seenAgo)}
                    {stale ? ' • STALE' : ''}
                  </div>
                </div>
                <ArrowIcon />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [printerList, setPrinterList] = useState<any[]>([]);
  const [clientList, setClientList] = useState<any[]>([]);
  const [todayJobs, setTodayJobs] = useState<any[]>([]);
  const [volumeData, setVolumeData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  const fetchData = async () => {
    try {
      const [printersRes, clientsRes, todayRes, volumeRes] = await Promise.all([
        printers.list(),
        clients.list(),
        jobsApi.stats.today(),
        analyticsApi.volume(7).catch(() => ({ data: [] })),
      ]);

      setPrinterList(printersRes.data || []);
      setClientList(clientsRes.data || []);

      const todayData = todayRes.data || {};
      const today = new Date().toDateString();
      const jobsArr = Array.isArray(todayData.jobs) ? todayData.jobs : [];
      setTodayJobs(jobsArr);

      // /api/analytics/volume returns an array [{date, jobs, pages}], not {jobs:[...]}
      setVolumeData(Array.isArray(volumeRes.data) ? volumeRes.data : []);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);

    const handleJobUpdate = () => fetchData();
    on('job:new', handleJobUpdate);
    on('job:complete', handleJobUpdate);

    return () => {
      clearInterval(interval);
      off('job:new', handleJobUpdate);
      off('job:complete', handleJobUpdate);
    };
  }, []);

  // ── Derived stats ──────────────────────────────────────────────────────────
  const onlinePrinters = printerList.filter((p: any) => p.status === 'online').length;
  const totalPrinters = printerList.length;
  // Trust the server's is_online flag (set/cleared on heartbeat) as the primary
  // signal. last_seen staleness is exposed separately so the UI can warn the
  // operator without falsely hiding nodes whose agents use a long heartbeat
  // interval.
  const STALE_HEARTBEAT_MS = 5 * 60 * 1000; // 5 minutes
  const isNodeOnline = (c: any) => c?.is_online === true;
  const isHeartbeatStale = (c: any) => {
    if (!c?.last_seen) return true;
    return Date.now() - new Date(c.last_seen).getTime() > STALE_HEARTBEAT_MS;
  };
  const activeClients = clientList.filter(isNodeOnline).length;
  const totalClients = clientList.length;
  const activeNodeList = clientList
    .filter(isNodeOnline)
    .sort((a: any, b: any) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());

  const today = new Date().toDateString();
  const todayFiltered = todayJobs.filter((j: any) => {
    const d = j.createdAt ? new Date(j.createdAt).toDateString() : '';
    return d === today;
  });
  const completedJobs = todayFiltered.filter((j: any) => j.status === 'completed').length;
  const pendingJobs = todayFiltered.filter((j: any) => j.status === 'pending').length;
  const processingJobs = todayFiltered.filter((j: any) => j.status === 'processing').length;
  const totalPages = todayFiltered.reduce((s: number, j: any) => s + (j.pages || 0), 0);

  // Chart data — fill zeros if empty
  const chartData = volumeData.length > 0 ? volumeData : Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { date: d.toISOString().split('T')[0], jobs: 0, pages: 0 };
  });

  const handleRefresh = () => {
    setLoading(true);
    fetchData();
  };

  if (loading) {
    return (
      <div className="space-y-6" style={{ padding: '0 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div className="skeleton-title" style={{ height: 28, width: 160, borderRadius: 6 }} />
          <div className="skeleton-pulse" style={{ height: 36, width: 120, borderRadius: 6 }} />
        </div>
        <div className="stat-cards">
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
        <div className="network-section">
          <div className="skeleton-pulse" style={{ height: 200, borderRadius: 8 }} />
        </div>
        <div className="charts-row">
          <div className="chart-card">
            <div className="skeleton-pulse" style={{ height: 200, borderRadius: 8 }} />
          </div>
          <div className="chart-card">
            <div className="skeleton-pulse" style={{ height: 200, borderRadius: 8 }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`dashboard-content ${isVisible ? 'visible' : ''}`} style={{ padding: '0 24px' }}>
      {/* Header */}
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'Rajdhani', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 2 }}>
          Dashboard
        </h1>
        <button
          onClick={handleRefresh}
          className="btn-primary"
          style={{ gap: 8 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="stat-cards">
        <StatCard
          icon={<PrinterIcon />}
          badge={onlinePrinters === totalPrinters && totalPrinters > 0 ? 'Online' : 'Warning'}
          badgeColor={onlinePrinters > 0 ? 'green' : 'amber'}
          value={onlinePrinters}
          total={totalPrinters}
          label="Total Printers"
          subtext={<><span style={{ color: 'var(--accent-green)' }}>{onlinePrinters}</span> of {totalPrinters} online</>}
          index={0}
        />
        <StatCard
          icon={<ServerIcon />}
          badge={activeClients > 0 ? 'Online' : 'Offline'}
          badgeColor={activeClients > 0 ? 'green' : 'amber'}
          value={activeClients}
          total={totalClients}
          label="Active Server Nodes"
          subtext={<><span style={{ color: activeClients > 0 ? 'var(--accent-green)' : 'var(--accent-amber)' }}>{activeClients}</span> of {totalClients} online</>}
          index={1}
        />
        <StatCard
          icon={<DocumentIcon />}
          badge="Today"
          badgeColor="cyan"
          value={todayFiltered.length}
          label="Today's Jobs"
          subtext={<><span style={{ color: 'var(--accent-green)' }}>{completedJobs}</span> completed</>}
          index={2}
        />
        <StatCard
          icon={<WarningIcon />}
          badge={pendingJobs > 0 ? 'Alert' : 'Clear'}
          badgeColor={pendingJobs > 0 ? 'amber' : 'green'}
          value={pendingJobs}
          label="Pending Queue"
          subtext="jobs waiting"
          index={3}
        />
      </div>

      {/* Live Active Server Nodes */}
      {activeNodeList.length > 0 && <ActiveNodeList nodes={activeNodeList} />}

      {/* Charts Row */}
      <div className="charts-row">
        {/* Print Volume — Bar Chart */}
        <div className="chart-card" style={{ '--index': 0 } as React.CSSProperties}>
          <div className="chart-title">Print Volume (7 Days)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'Share Tech Mono' }}
                tickFormatter={(val) => new Date(val).toLocaleDateString('en', { weekday: 'short' })}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--accent-cyan)', borderRadius: 8, fontFamily: 'Share Tech Mono', color: 'var(--text-primary)' }}
                labelStyle={{ color: 'var(--text-primary)' }}
                itemStyle={{ color: 'var(--accent-cyan)' }}
              />
              <Bar dataKey="jobs" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={`url(#barGrad)`} />
                ))}
              </Bar>
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0.2} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pages Printed — Area Chart */}
        <div className="chart-card" style={{ '--index': 1 } as React.CSSProperties}>
          <div className="chart-title">Pages Printed (7 Days)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fill: 'var(--text-muted)', fontSize: 11, fontFamily: 'Share Tech Mono' }}
                tickFormatter={(val) => new Date(val).toLocaleDateString('en', { weekday: 'short' })}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
              />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--accent-cyan)', borderRadius: 8, fontFamily: 'Share Tech Mono', color: 'var(--text-primary)' }}
                labelStyle={{ color: 'var(--text-primary)' }}
                itemStyle={{ color: 'var(--accent-cyan)' }}
              />
              <Area
                type="monotone"
                dataKey="pages"
                stroke="var(--accent-cyan)"
                strokeWidth={2.5}
                fill="url(#areaGrad)"
                dot={{ fill: 'var(--accent-cyan)', r: 3 }}
                activeDot={{ r: 5, fill: 'var(--accent-cyan)', filter: 'drop-shadow(0 0 4px var(--accent-cyan))' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Panels */}
      <div className="bottom-panels">
        {/* Quick Stats */}
        <div className="panel-card">
          <div className="panel-title">Quick Stats</div>
          <div className="quick-stat-row">
            <div className="quick-stat-left">
              <CheckIcon color="var(--accent-green)" />
              <span style={{ fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Completed Today
              </span>
            </div>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              {completedJobs}
            </span>
          </div>
          <div className="quick-stat-row">
            <div className="quick-stat-left">
              <ClockIcon color="var(--accent-amber)" />
              <span style={{ fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Pending Jobs
              </span>
            </div>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              {pendingJobs}
            </span>
          </div>
          <div className="quick-stat-row">
            <div className="quick-stat-left">
              <ActivityIcon color="var(--accent-cyan)" />
              <span style={{ fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Processing
              </span>
            </div>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              {processingJobs}
            </span>
          </div>
          <div className="quick-stat-row" style={{ borderBottom: 'none' }}>
            <div className="quick-stat-left">
              <DocumentIcon />
              <span style={{ fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Total Pages
              </span>
            </div>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 20, fontWeight: 700, color: 'var(--accent-cyan)' }}>
              {totalPages.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Printer Status */}
        <div className="panel-card">
          <div className="panel-title">Printer Status</div>

          <div className="printer-status-summary">
            <span style={{ color: 'var(--accent-green)' }}>● {onlinePrinters} Online</span>
            <span style={{ color: 'var(--accent-red)' }}>● {totalPrinters - onlinePrinters} Offline</span>
          </div>

          <div className="printer-status-list">
            {printerList.length === 0 ? (
              <div className="empty-state">NO PRINTERS REGISTERED</div>
            ) : (
              printerList.map((p: any, index: number) => (
                <div key={p.id} className="printer-status-item" style={{ '--index': index } as React.CSSProperties}>
                  <div className="printer-status-left">
                    <div className={`status-indicator ${p.status === 'online' ? 'green' : 'red'}`} />
                    <div>
                      <div className="printer-name">{p.name}</div>
                      <div className="printer-location">
                        {p.location || 'Unknown'} · {p.ip || 'No IP'}
                      </div>
                    </div>
                  </div>
                  <span style={{
                    fontFamily: 'Share Tech Mono', fontSize: 10,
                    color: p.status === 'online' ? 'var(--accent-green)' : 'var(--accent-red)',
                    textTransform: 'uppercase',
                  }}>
                    {p.status}
                  </span>
                </div>
              ))
            )}
          </div>

          <Link href="/printers" className="manage-link">
            Manage Printers <ArrowIcon />
          </Link>
        </div>
      </div>
    </div>
  );
}
