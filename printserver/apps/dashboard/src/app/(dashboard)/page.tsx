'use client';

import { useEffect, useState, useRef } from 'react';
import { jobs as jobsApi, printers, clients } from '@/lib/api';
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

function WifiIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
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
}: {
  icon: React.ReactNode;
  badge: string;
  badgeColor: 'green' | 'amber' | 'cyan';
  value: number;
  total?: number;
  label: string;
  subtext: string;
}) {
  const animated = useCountUp(value);
  const pct = total && total > 0 ? (value / total) * 100 : 0;

  const badgeColors: Record<string, React.CSSProperties> = {
    green: { background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', color: '#00ff88' },
    amber: { background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' },
    cyan: { background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', color: '#00d4ff' },
  };

  return (
    <div className="stat-card">
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

// ─── Network Topology ──────────────────────────────────────────────────────────

function NetworkTopology({ printers: printerList, clients: clientList }: { printers: any[]; clients: any[] }) {
  const onlinePrinters = printerList.filter((p: any) => p.status === 'online');
  const offlinePrinters = printerList.filter((p: any) => p.status !== 'online');

  const centerX = 500;
  const centerY = 200;
  const radius = 140;

  const printerPositions = printerList.map((p: any, i: number) => {
    const angle = ((i - (printerList.length - 1) / 2) / Math.max(printerList.length, 1)) * Math.PI * 0.7 - Math.PI / 2;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      printer: p,
    };
  });

  const clientPositions = clientList.slice(0, 4).map((c: any, i: number) => {
    const angle = ((i - (Math.min(clientList.length, 4) - 1) / 2) / Math.max(Math.min(clientList.length, 4), 1)) * Math.PI * 0.6 + Math.PI * 0.2;
    return {
      x: centerX + (radius + 80) * Math.cos(angle),
      y: centerY + (radius + 80) * Math.sin(angle),
      client: c,
    };
  });

  return (
    <div className="network-section">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <span style={{ color: 'var(--accent-cyan)' }}><WifiIcon /></span>
        <span style={{ fontFamily: 'Rajdhani', fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)' }}>
          Network Topology
        </span>
      </div>
      <div className="network-map">
        <svg viewBox="0 0 1000 400" style={{ width: '100%', height: 'auto' }}>
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glowGreen">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Connection lines */}
          {printerPositions.map((pos, i) => (
            <line
              key={`line-${i}`}
              x1={centerX} y1={centerY}
              x2={pos.x} y2={pos.y}
              stroke="#1e3050"
              strokeWidth="2"
            />
          ))}
          {clientPositions.map((pos, i) => (
            <line
              key={`cline-${i}`}
              x1={centerX} y1={centerY}
              x2={pos.x} y2={pos.y}
              stroke="#1e3050"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          ))}

          {/* Animated packets on online printer lines */}
          {printerPositions.filter(p => p.printer.status === 'online').map((pos, i) => (
            <circle key={`packet-${i}`} r="4" fill="#00d4ff" opacity="0.8">
              <animateMotion
                path={`M${centerX},${centerY} L${pos.x},${pos.y}`}
                dur={`${2.8 + i * 0.3}s`
}
                repeatCount="indefinite"
                begin={`${i * 0.5}s`}
              />
            </circle>
          ))}

          {/* Center node — PRINT SERVER */}
          <rect
            x={centerX - 60} y={centerY - 20}
            width={120} height={40}
            rx="6"
            fill="#111c30"
            stroke="#00d4ff"
            strokeWidth="2"
            filter="url(#glow)"
          />
          <circle cx={centerX - 45} cy={centerY} r="5" fill="#00ff88" filter="url(#glowGreen)">
            <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
          </circle>
          <text
            x={centerX + 5} y={centerY + 4}
            textAnchor="middle"
            fill="#e2f0ff"
            fontSize="11"
            fontFamily="Share Tech Mono"
            fontWeight="600"
          >
            PRINT SERVER
          </text>

          {/* Printer nodes */}
          {printerPositions.length === 0 ? (
            <text x={centerX} y={centerY - 60} textAnchor="middle" fill="#4a6080" fontSize="12" fontFamily="Share Tech Mono">
              NO NODES CONNECTED
            </text>
          ) : (
            printerPositions.map((pos, i) => {
              const p = pos.printer;
              const isOnline = p.status === 'online';
              return (
                <g key={`printer-${i}`} opacity={isOnline ? 1 : 0.6}>
                  <rect
                    x={pos.x - 45} y={pos.y - 18}
                    width={90} height={36}
                    rx="5"
                    fill="#111c30"
                    stroke={isOnline ? '#00d4ff' : '#ff3d5a'}
                    strokeWidth="1.5"
                  />
                  <circle
                    cx={pos.x - 32} cy={pos.y}
                    r="4"
                    fill={isOnline ? '#00ff88' : '#ff3d5a'}
                    filter={isOnline ? 'url(#glowGreen)' : ''}
                  >
                    {!isOnline && (
                      <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite" />
                    )}
                  </circle>
                  <text x={pos.x + 5} y={pos.y - 4} textAnchor="middle" fill="#e2f0ff" fontSize="10" fontFamily="Rajdhani" fontWeight="600">
                    {p.name?.slice(0, 12) || `Printer ${i + 1}`}
                  </text>
                  <text x={pos.x + 5} y={pos.y + 8} textAnchor="middle" fill="#4a6080" fontSize="9" fontFamily="Share Tech Mono">
                    {p.ip || p.id?.toString().slice(-4) || ''}
                  </text>
                </g>
              );
            })
          )}

          {/* Client nodes */}
          {clientPositions.map((pos, i) => (
            <g key={`client-${i}`}>
              <rect
                x={pos.x - 30} y={pos.y - 12}
                width={60} height={24}
                rx="4"
                fill="#0d1526"
                stroke="#1e3050"
                strokeWidth="1"
              />
              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill="#4a6080" fontSize="9" fontFamily="Share Tech Mono">
                {pos.client.name?.slice(0, 10) || `CLT-${i + 1}`}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [printers, setPrinters] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [todayJobs, setTodayJobs] = useState<any[]>([]);
  const [volumeData, setVolumeData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [printersRes, clientsRes, todayRes, volumeRes] = await Promise.all([
        printers.list(),
        clients.list(),
        jobsApi.stats.today(),
        fetch('/api/stats?range=7d').catch(() => ({ ok: false, json: () => ({ jobs: [] }) })),
      ]);

      setPrinters(printersRes.data || []);
      setClients(clientsRes.data || []);

      const todayData = todayRes.data || {};
      const today = new Date().toDateString();
      const jobsArr = Array.isArray(todayData.jobs) ? todayData.jobs : [];
      setTodayJobs(jobsArr);

      if (volumeRes.ok) {
        const vd = await volumeRes.json();
        setVolumeData(vd.jobs || []);
      }
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
  const onlinePrinters = printers.filter((p: any) => p.status === 'online').length;
  const totalPrinters = printers.length;
  const activeClients = clients.filter((c: any) => c.active || c.online).length;
  const totalClients = clients.length;

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
          <div className="skeleton-pulse" style={{ height: 28, width: 160, borderRadius: 6 }} />
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
    <div className="space-y-6" style={{ padding: '0 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Rajdhani', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 2 }}>
          Dashboard
        </h1>
        <button
          onClick={handleRefresh}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px',
            background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)',
            borderRadius: 6, color: 'var(--accent-cyan)',
            fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', textTransform: 'uppercase', letterSpacing: 1,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Stat Cards */}
      <div className="stat-cards">
        <StatCard
          icon={<PrinterIcon />}
          badge={onlinePrinters === totalPrinters && totalPrinters > 0 ? 'Online' : 'Warning'}
          badgeColor={onlinePrinters > 0 ? 'green' : 'amber'}
          value={totalPrinters}
          total={totalPrinters}
          label="Total Printers"
          subtext={<><span style={{ color: '#00ff88' }}>{onlinePrinters}</span> of {totalPrinters} online</>}
        />
        <StatCard
          icon={<MonitorIcon />}
          badge="Active"
          badgeColor="cyan"
          value={activeClients}
          total={totalClients}
          label="Active Clients"
          subtext={<><span style={{ color: '#00d4ff' }}>{activeClients}</span> of {totalClients} total</>}
        />
        <StatCard
          icon={<DocumentIcon />}
          badge="Today"
          badgeColor="cyan"
          value={todayFiltered.length}
          label="Today's Jobs"
          subtext={<><span style={{ color: '#00ff88' }}>{completedJobs}</span> completed</>}
        />
        <StatCard
          icon={<WarningIcon />}
          badge={pendingJobs > 0 ? 'Alert' : 'Clear'}
          badgeColor={pendingJobs > 0 ? 'amber' : 'green'}
          value={pendingJobs}
          label="Pending Queue"
          subtext="jobs waiting"
        />
      </div>

      {/* Network Topology */}
      <NetworkTopology printers={printers} clients={clients} />

      {/* Charts Row */}
      <div className="charts-row">
        {/* Print Volume — Bar Chart */}
        <div className="chart-card">
          <div className="chart-title">Print Volume (7 Days)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: '#4a6080', fontSize: 11, fontFamily: 'Share Tech Mono' }}
                tickFormatter={(val) => new Date(val).toLocaleDateString('en', { weekday: 'short' })}
                axisLine={{ stroke: '#1e3050' }}
                tickLine={false}
              />
              <YAxis tick={{ fill: '#4a6080', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#111c30', border: '1px solid #00d4ff', borderRadius: 6, fontFamily: 'Share Tech Mono' }}
                labelStyle={{ color: '#e2f0ff' }}
                itemStyle={{ color: '#00d4ff' }}
              />
              <Bar dataKey="jobs" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={`url(#barGrad)`} />
                ))}
              </Bar>
              <defs>
                <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#00d4ff" stopOpacity={0.2} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Pages Printed — Area Chart */}
        <div className="chart-card">
          <div className="chart-title">Pages Printed (7 Days)</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#00d4ff" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fill: '#4a6080', fontSize: 11, fontFamily: 'Share Tech Mono' }}
                tickFormatter={(val) => new Date(val).toLocaleDateString('en', { weekday: 'short' })}
                axisLine={{ stroke: '#1e3050' }}
                tickLine={false}
              />
              <YAxis tick={{ fill: '#4a6080', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#111c30', border: '1px solid #00d4ff', borderRadius: 6, fontFamily: 'Share Tech Mono' }}
                labelStyle={{ color: '#e2f0ff' }}
                itemStyle={{ color: '#00d4ff' }}
              />
              <Area
                type="monotone"
                dataKey="pages"
                stroke="#00d4ff"
                strokeWidth={2.5}
                fill="url(#areaGrad)"
                dot={{ fill: '#00d4ff', r: 3 }}
                activeDot={{ r: 5, fill: '#00d4ff', filter: 'drop-shadow(0 0 4px #00d4ff)' }}
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
              <CheckIcon color="#00ff88" />
              <span style={{ fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Completed Today
              </span>
            </div>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 20, fontWeight: 700, color: '#e2f0ff' }}>
              {completedJobs}
            </span>
          </div>
          <div className="quick-stat-row">
            <div className="quick-stat-left">
              <ClockIcon color="#f59e0b" />
              <span style={{ fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Pending Jobs
              </span>
            </div>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 20, fontWeight: 700, color: '#e2f0ff' }}>
              {pendingJobs}
            </span>
          </div>
          <div className="quick-stat-row">
            <div className="quick-stat-left">
              <ActivityIcon color="#00d4ff" />
              <span style={{ fontFamily: 'Rajdhani', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Processing
              </span>
            </div>
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 20, fontWeight: 700, color: '#e2f0ff' }}>
              {processingJobs}
            </span>
          </div>
        </div>

        {/* Printer Status */}
        <div className="panel-card">
          <div className="panel-title">Printer Status</div>

          <div className="printer-status-summary">
            <span style={{ color: '#00ff88' }}>● {onlinePrinters} Online</span>
            <span style={{ color: '#ff3d5a' }}>● {totalPrinters - onlinePrinters} Offline</span>
          </div>

          <div className="printer-status-list">
            {printers.length === 0 ? (
              <div className="empty-state">NO PRINTERS REGISTERED</div>
            ) : (
              printers.map((p: any) => (
                <div key={p.id} className="printer-status-item">
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
                    color: p.status === 'online' ? '#00ff88' : '#ff3d5a',
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
