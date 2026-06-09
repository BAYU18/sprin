'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { clients as clientsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  ArrowLeft, Wifi, WifiOff, Cpu, Server, Printer, FileText, Clock,
  CheckCircle2, XCircle, Loader2, RefreshCw, Network, HardDrive, Hash, Activity
} from 'lucide-react';
import { format } from 'date-fns';

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(Date.now());

  const fetchDetail = useCallback(async () => {
    try {
      const res = await clientsApi.get(id);
      setData(res.data);
      setNotFound(false);
    } catch (e: any) {
      if (e?.response?.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) { setNotFound(true); setLoading(false); return; }
    fetchDetail();
    const t = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(fetchDetail, 15000);
    const hb = (d: any) => { if (d.clientId === id) fetchDetail(); };
    on('client:heartbeat', hb);
    on('client:online', hb);
    on('client:offline', hb);
    return () => {
      clearInterval(t); clearInterval(refresh);
      off('client:heartbeat', hb); off('client:online', hb); off('client:offline', hb);
    };
  }, [id, fetchDetail]);

  const C = {
    cyan: 'var(--accent-cyan)', green: 'var(--accent-green)', amber: 'var(--accent-amber)',
    red: '#ff3d5a', muted: 'var(--text-muted)', text: 'var(--text-primary)',
    border: 'var(--border)', card: 'var(--bg-card)', sec: 'var(--bg-secondary)',
    mono: "'Share Tech Mono', monospace", sans: "'Rajdhani', sans-serif",
  };

  const fmtUptime = (since: string | null, online: boolean) => {
    if (!since || !online) return 'Offline';
    const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  };

  const fmtAgo = (ts: string | null) => {
    if (!ts) return 'Never';
    const s = Math.max(0, Math.floor((now - new Date(ts).getTime()) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  const isUnroutable = (ip = '') => {
    const l = ip.toLowerCase().trim();
    return !ip || l === '::1' || l.startsWith('fe80:') || l === '127.0.0.1';
  };

  const osLabel = (os = '') => {
    const o = os.toLowerCase();
    if (o.includes('windows 11')) return 'Windows 11';
    if (o.includes('windows 10')) return 'Windows 10';
    if (o.includes('win32')) return 'Windows';
    return os || 'Unknown';
  };

  if (loading) {
    return (
      <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Loader2 className="spin" size={28} style={{ color: C.cyan, animation: 'spin 1s linear infinite' }} />
        <div style={{ color: C.muted, fontFamily: C.sans }}>Loading node telemetry...</div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <WifiOff size={40} style={{ color: C.red }} />
        <h2 style={{ fontFamily: C.mono, color: C.text, margin: 0 }}>NODE NOT FOUND</h2>
        <p style={{ color: C.muted, fontFamily: C.sans, margin: 0 }}>Node #{id} tidak terdaftar atau sudah dihapus.</p>
        <button onClick={() => router.push('/clients')} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <ArrowLeft size={16} /> Kembali ke Clients
        </button>
      </div>
    );
  }

  const printers: any[] = data.printers?.length ? data.printers : (data.metadata?.printers || []);
  const stats = data.jobStats || {};
  const jobs: any[] = data.recentJobs || [];
  const online = !!data.is_online;

  const statCards = [
    { label: 'Total Jobs', value: stats.total ?? 0, icon: <FileText size={18} />, color: C.cyan },
    { label: 'Completed', value: stats.completed ?? 0, icon: <CheckCircle2 size={18} />, color: C.green },
    { label: 'Failed', value: stats.failed ?? 0, icon: <XCircle size={18} />, color: C.red },
    { label: 'Jobs Today', value: stats.today ?? 0, icon: <Activity size={18} />, color: C.amber },
    { label: 'Pages Printed', value: stats.pagesPrinted ?? 0, icon: <FileText size={18} />, color: C.cyan },
    { label: 'Printers', value: printers.length, icon: <Printer size={18} />, color: C.amber },
  ];

  const sysRows = [
    { k: 'Computer Name', v: data.hostname, icon: <Cpu size={14} />, color: C.text },
    { k: 'IPv4 Address', v: isUnroutable(data.ip_address) ? (data.ip_address || '— link-local') : data.ip_address, icon: <Network size={14} />, color: isUnroutable(data.ip_address) ? C.red : C.cyan },
    { k: 'MAC Address', v: data.mac_address || 'N/A', icon: <Hash size={14} />, color: C.text },
    { k: 'Operating System', v: osLabel(data.os_version), icon: <HardDrive size={14} />, color: C.text },
    { k: 'Agent Version', v: `v${data.client_version || '1.0.0'}`, icon: <Server size={14} />, color: C.cyan },
    { k: 'Uptime', v: fmtUptime(data.last_seen && online ? data.created_at : null, online), icon: <Clock size={14} />, color: online ? C.green : C.muted },
    { k: 'Last Pulse', v: fmtAgo(data.last_seen), icon: <Activity size={14} />, color: C.text },
    { k: 'Registered', v: data.created_at ? format(new Date(data.created_at), 'dd MMM yyyy HH:mm') : 'N/A', icon: <Clock size={14} />, color: C.muted },
  ];

  const statusColor = (s = '') => {
    const x = s.toLowerCase();
    if (x === 'completed') return C.green;
    if (x === 'failed' || x === 'cancelled') return C.red;
    if (x === 'printing') return C.cyan;
    return C.amber;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => router.push('/clients')} style={{ background: C.sec, border: `1px solid ${C.border}`, borderRadius: 8, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, cursor: 'pointer' }}>
            <ArrowLeft size={18} />
          </button>
          <div style={{ width: 46, height: 46, borderRadius: 10, background: online ? 'rgba(0,255,136,0.1)' : C.sec, border: `1px solid ${online ? 'rgba(0,255,136,0.3)' : C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: online ? C.green : C.muted, boxShadow: online ? '0 0 16px rgba(0,255,136,0.25)' : 'none' }}>
            {online ? <Wifi size={22} /> : <WifiOff size={22} />}
          </div>
          <div>
            <h1 style={{ margin: 0, fontFamily: C.mono, fontSize: 22, color: C.text, letterSpacing: 1 }}>{data.hostname}</h1>
            <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
              Node #{data.id} · {isUnroutable(data.ip_address) ? 'no LAN ip' : data.ip_address}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: C.mono, fontSize: 11, padding: '4px 12px', borderRadius: 6, background: online ? 'rgba(0,255,136,0.12)' : C.sec, color: online ? C.green : C.muted, border: `1px solid ${online ? 'rgba(0,255,136,0.3)' : C.border}` }}>
            {online ? '● ONLINE' : '○ OFFLINE'}
          </span>
          <button onClick={fetchDetail} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
        {statCards.map((s, i) => (
          <div key={i} className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ color: s.color }}>{s.icon}</span>
            </div>
            <div style={{ fontFamily: C.mono, fontSize: 28, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Two-column: system info + printers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* System info */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server size={16} style={{ color: C.cyan }} /> System Telemetry
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sysRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < sysRows.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                  <span style={{ color: C.muted }}>{r.icon}</span>{r.k}
                </span>
                <span style={{ fontFamily: C.mono, fontSize: 13, color: r.color }}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Printers */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Printer size={16} style={{ color: C.amber }} /> Connected Printers ({printers.length})
          </h3>
          {printers.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontFamily: C.sans, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
              Belum ada printer terdeteksi dari node ini.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {printers.map((p: any, i: number) => {
                const name = typeof p === 'string' ? p : (p?.name || 'Unknown');
                const port = typeof p === 'object' ? (p?.port || '') : '';
                const pstatus = typeof p === 'object' ? (p?.status || (online ? 'online' : 'offline')) : (online ? 'online' : 'offline');
                const ok = pstatus === 'online';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: C.sec, borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? C.green : C.muted, boxShadow: ok ? `0 0 8px ${C.green}` : 'none', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: C.mono, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                      {port && <div style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, marginTop: 2 }}>{port}</div>}
                    </div>
                    <span style={{ fontFamily: C.mono, fontSize: 10, color: ok ? C.green : C.muted }}>{ok ? 'ONLINE' : 'OFFLINE'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent jobs */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} style={{ color: C.green }} /> Recent Jobs
        </h3>
        {jobs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontFamily: C.sans, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            Belum ada riwayat job dari node ini.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {jobs.map((j: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: C.sec, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <FileText size={15} style={{ color: C.muted, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: C.sans, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.job_name || j.file_name || 'Untitled'}
                  </div>
                  <div style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, marginTop: 2 }}>
                    {j.pages || 0}p · {j.created_at ? format(new Date(j.created_at), 'dd/MM HH:mm') : ''}
                  </div>
                </div>
                <span style={{ fontFamily: C.mono, fontSize: 10, padding: '3px 8px', borderRadius: 4, color: statusColor(j.status), border: `1px solid ${statusColor(j.status)}33`, textTransform: 'uppercase' }}>
                  {j.status || 'unknown'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
