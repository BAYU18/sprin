'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { health, printers as printersApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw,
  Wifi, WifiOff, Clock, TrendingUp, TrendingDown, Zap
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

const C = {
  cyan: 'var(--accent-cyan)', green: 'var(--accent-green)', amber: 'var(--accent-amber)',
  red: '#ff3d5a', muted: 'var(--text-muted)', text: 'var(--text-primary)',
  border: 'var(--border)', card: 'var(--bg-card)', sec: 'var(--bg-secondary)',
  mono: "'Share Tech Mono', monospace", sans: "'Rajdhani', sans-serif",
};

const fmtAgo = (ts: string | null) => {
  if (!ts) return 'Never';
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function HealthPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<{ checked: number; with_issues: number; alerts_created: number } | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await health.allPrinters();
      setRows(res.data || []);
    } catch (e) {
      console.error('Failed to load health:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    // Refresh on printer changes
    const handler = () => fetchHealth();
    on('printer:patch', handler);
    on('printer:created', handler);
    on('printer:removed', handler);
    on('alert:created', handler);
    on('alert:resolved', handler);
    return () => {
      off('printer:patch', handler);
      off('printer:created', handler);
      off('printer:removed', handler);
      off('alert:created', handler);
      off('alert:resolved', handler);
    };
  }, [fetchHealth]);

  const runCheck = async () => {
    setChecking(true);
    try {
      const res = await health.checkAll();
      setLastCheck(res.data);
      fetchHealth();
    } catch (e: any) {
      alert(`Check failed: ${e.message}`);
    } finally {
      setChecking(false);
    }
  };

  // Aggregate stats
  const totalPrinters = rows.length;
  const onlinePrinters = rows.filter(r => r.status === 'online').length;
  const offlinePrinters = rows.filter(r => r.status === 'offline' || r.status === 'unhealthy').length;
  const totalPages = rows.reduce((sum, r) => sum + (r.total_jobs_24h || 0), 0);
  const totalErrors = rows.reduce((sum, r) => sum + Math.round((r.error_rate_24h || 0) * (r.total_jobs_24h || 0) / 100), 0);
  const avgUptime = totalPrinters > 0
    ? Math.round(rows.reduce((sum, r) => sum + (r.uptime_24h || 0), 0) / totalPrinters * 100) / 100
    : 100;

  if (loading) {
    return (
      <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Loader2 size={28} style={{ color: C.cyan, animation: 'spin 1s linear infinite' }} />
        <div style={{ color: C.muted, fontFamily: C.sans }}>Loading printer health...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 10, background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.green }}>
            <Activity size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontFamily: C.mono, fontSize: 22, color: C.text, letterSpacing: 1 }}>PRINTER HEALTH</h1>
            <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
              {totalPrinters} printer{totalPrinters !== 1 ? 's' : ''} monitored
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={runCheck}
            disabled={checking}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: checking ? 'wait' : 'pointer' }}
          >
            {checking ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={15} />}
            {checking ? 'Checking...' : 'Check All'}
          </button>
          <button onClick={fetchHealth} className="btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* Last check notification */}
      {lastCheck && (
        <div className="card" style={{ padding: 12, background: lastCheck.with_issues > 0 ? 'rgba(255,61,90,0.05)' : 'rgba(0,255,136,0.05)', border: `1px solid ${lastCheck.with_issues > 0 ? 'rgba(255,61,90,0.3)' : 'rgba(0,255,136,0.3)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastCheck.with_issues > 0 ? <AlertTriangle size={16} style={{ color: C.amber }} /> : <CheckCircle2 size={16} style={{ color: C.green }} />}
            <div style={{ fontFamily: C.sans, fontSize: 13, color: C.text }}>
              Checked <strong>{lastCheck.checked}</strong> printers · {lastCheck.with_issues} with issues · {lastCheck.alerts_created} new alert{lastCheck.alerts_created !== 1 ? 's' : ''} created
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Wifi size={18} style={{ color: C.green }} />
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Online</span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 28, fontWeight: 700, color: C.green, lineHeight: 1 }}>{onlinePrinters}</div>
          <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>of {totalPrinters} printers</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <WifiOff size={18} style={{ color: offlinePrinters > 0 ? C.red : C.muted }} />
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Offline</span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 28, fontWeight: 700, color: offlinePrinters > 0 ? C.red : C.muted, lineHeight: 1 }}>{offlinePrinters}</div>
          <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>need attention</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Activity size={18} style={{ color: C.cyan }} />
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Avg Uptime 24h</span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 28, fontWeight: 700, color: avgUptime >= 95 ? C.green : avgUptime >= 80 ? C.amber : C.red, lineHeight: 1 }}>{avgUptime.toFixed(1)}%</div>
          <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>across all printers</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <TrendingUp size={18} style={{ color: C.cyan }} />
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Jobs Today</span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 28, fontWeight: 700, color: C.cyan, lineHeight: 1 }}>{totalPages}</div>
          <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>last 24 hours</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <AlertTriangle size={18} style={{ color: totalErrors > 0 ? C.red : C.green }} />
            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, textTransform: 'uppercase' }}>Failed Jobs</span>
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 28, fontWeight: 700, color: totalErrors > 0 ? C.red : C.green, lineHeight: 1 }}>{totalErrors}</div>
          <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>last 24 hours</div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="desktop-only">
          <div style={{ display: 'grid', gridTemplateColumns: '40px 1.5fr 90px 110px 110px 110px 100px 130px', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, fontFamily: C.sans, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
            <div></div>
            <div>Printer</div>
            <div>Status</div>
            <div>Uptime 24h</div>
            <div>Uptime 7d</div>
            <div>Error Rate</div>
            <div>Jobs 24h</div>
            <div>Last Offline</div>
          </div>
          {rows.map((r: any) => {
            const isOnline = r.status === 'online';
            const errColor = r.error_rate_24h > 50 ? C.red : r.error_rate_24h > 20 ? C.amber : C.green;
            const up24Color = r.uptime_24h >= 95 ? C.green : r.uptime_24h >= 80 ? C.amber : C.red;
            return (
              <Link
                key={r.printer_id}
                href={`/printers/${r.printer_id}`}
                style={{ textDecoration: 'none', display: 'grid', gridTemplateColumns: '40px 1.5fr 90px 110px 110px 110px 100px 130px', padding: '12px 16px', borderBottom: `1px solid ${C.border}`, alignItems: 'center', transition: 'background 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.sec; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOnline ? C.green : C.red, boxShadow: isOnline ? `0 0 8px ${C.green}` : `0 0 8px ${C.red}` }} />
                </div>
                <div style={{ fontFamily: C.sans, fontSize: 13, color: C.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.printer_name}
                </div>
                <div style={{ fontFamily: C.mono, fontSize: 10, padding: '3px 8px', borderRadius: 4, color: isOnline ? C.green : C.red, border: `1px solid ${isOnline ? C.green : C.red}55`, background: `${isOnline ? C.green : C.red}11`, textTransform: 'uppercase', textAlign: 'center' }}>
                  {r.status}
                </div>
                <div style={{ fontFamily: C.mono, fontSize: 13, color: up24Color, fontWeight: 600 }}>{(r.uptime_24h || 0).toFixed(1)}%</div>
                <div style={{ fontFamily: C.mono, fontSize: 13, color: C.text }}>{(r.uptime_7d || 0).toFixed(1)}%</div>
                <div style={{ fontFamily: C.mono, fontSize: 13, color: errColor, fontWeight: 600 }}>{(r.error_rate_24h || 0).toFixed(1)}%</div>
                <div style={{ fontFamily: C.mono, fontSize: 13, color: C.text }}>{r.total_jobs_24h || 0}</div>
                <div style={{ fontFamily: C.mono, fontSize: 11, color: C.muted }}>{fmtAgo(r.last_offline_at)}</div>
              </Link>
            );
          })}
        </div>

        {/* Mobile card view */}
        <div className="mobile-only" style={{ display: 'none', flexDirection: 'column', gap: 1, background: C.border }}>
          {rows.map((r: any) => {
            const isOnline = r.status === 'online';
            const errColor = r.error_rate_24h > 50 ? C.red : r.error_rate_24h > 20 ? C.amber : C.green;
            const up24Color = r.uptime_24h >= 95 ? C.green : r.uptime_24h >= 80 ? C.amber : C.red;
            return (
              <Link
                key={`m-${r.printer_id}`}
                href={`/printers/${r.printer_id}`}
                style={{ textDecoration: 'none', padding: 14, background: C.card, display: 'flex', flexDirection: 'column', gap: 8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOnline ? C.green : C.red, boxShadow: isOnline ? `0 0 8px ${C.green}` : `0 0 8px ${C.red}` }} />
                    <span style={{ fontFamily: C.sans, fontSize: 14, color: C.text, fontWeight: 600 }}>{r.printer_name}</span>
                  </div>
                  <span style={{ fontFamily: C.mono, fontSize: 10, padding: '2px 6px', borderRadius: 4, color: isOnline ? C.green : C.red, border: `1px solid ${isOnline ? C.green : C.red}55`, background: `${isOnline ? C.green : C.red}11`, textTransform: 'uppercase' }}>
                    {r.status}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 11 }}>
                  <div>
                    <div style={{ color: C.muted, textTransform: 'uppercase', fontSize: 9, letterSpacing: 1 }}>Uptime 24h</div>
                    <div style={{ fontFamily: C.mono, color: up24Color, fontWeight: 600, fontSize: 14 }}>{(r.uptime_24h || 0).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div style={{ color: C.muted, textTransform: 'uppercase', fontSize: 9, letterSpacing: 1 }}>Errors</div>
                    <div style={{ fontFamily: C.mono, color: errColor, fontWeight: 600, fontSize: 14 }}>{(r.error_rate_24h || 0).toFixed(0)}%</div>
                  </div>
                  <div>
                    <div style={{ color: C.muted, textTransform: 'uppercase', fontSize: 9, letterSpacing: 1 }}>Jobs</div>
                    <div style={{ fontFamily: C.mono, color: C.text, fontWeight: 600, fontSize: 14 }}>{r.total_jobs_24h || 0}</div>
                  </div>
                </div>
                {r.last_offline_at && (
                  <div style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={10} /> Last offline: {fmtAgo(r.last_offline_at)}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      {rows.length === 0 && !loading && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: C.muted }}>
          <Activity size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
          <div style={{ fontFamily: C.sans, fontSize: 14 }}>No printers to monitor.</div>
          <div style={{ fontFamily: C.sans, fontSize: 12, marginTop: 6, opacity: 0.7 }}>
            Once a client agent reports a printer, health snapshots will appear here.
          </div>
        </div>
      )}

      <style jsx>{`
        @media (max-width: 768px) {
          :global(.desktop-only) { display: none !important; }
          :global(.mobile-only) { display: flex !important; }
        }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
