'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { queues, printers as printersApi, jobs as jobsApi } from '@/lib/api';
import { on, off, getSocket } from '@/hooks/useSocket';
import {
  Layers, ListOrdered, Loader2, RefreshCw, Pause, Play,
  ChevronUp, ChevronDown, XCircle, FileText, Printer as PrinterIcon,
  Clock, AlertCircle, Search, Filter
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

const C = {
  cyan: 'var(--accent-cyan)', green: 'var(--accent-green)', amber: 'var(--accent-amber)',
  red: '#ff3d5a', muted: 'var(--text-muted)', text: 'var(--text-primary)',
  border: 'var(--border)', card: 'var(--bg-card)', sec: 'var(--bg-secondary)',
  mono: "'Share Tech Mono', monospace", sans: "'Rajdhani', sans-serif",
};

const statusColor = (s: string = '') => {
  const x = s.toLowerCase();
  if (x === 'completed') return C.green;
  if (x === 'failed' || x === 'cancelled') return C.red;
  if (x === 'processing' || x === 'active') return C.cyan;
  if (x === 'paused' || x === 'held') return C.amber;
  return C.amber;
};

const statusBadge = (s: string = '') => {
  const c = statusColor(s);
  return {
    color: c, border: `${c}55`, bg: `${c}11`,
  };
};

export default function QueuesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [printers, setPrinters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [printerFilter, setPrinterFilter] = useState<string>('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [queueRes, printerRes] = await Promise.all([
        queues.list({
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(printerFilter ? { printer_id: Number(printerFilter) } : {}),
          limit: 200,
        }),
        printersApi.list(),
      ]);
      setItems(queueRes.data?.queues || []);
      setPrinters(printerRes.data || []);
    } catch (e) {
      console.error('Failed to load queues:', e);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, printerFilter]);

  useEffect(() => {
    fetchAll();
    // Socket: live updates
    const handleUpdate = () => fetchAll();
    on('queue:updated', handleUpdate);
    on('queue:paused', handleUpdate);
    on('queue:resumed', handleUpdate);
    on('job:new', handleUpdate);
    on('job:complete', handleUpdate);
    on('job:error', handleUpdate);
    on('job:held', handleUpdate);
    on('job:released', handleUpdate);

    // WS-fallback polling
    const wsFallback = (getSocket() as any);
    let interval: any = null;
    const onDisconnect = () => { interval = setInterval(fetchAll, 20000); };
    const onConnect = () => { if (interval) { clearInterval(interval); interval = null; } };
    if (wsFallback && !wsFallback.connected) onDisconnect();
    wsFallback?.on?.('disconnect', onDisconnect);
    wsFallback?.on?.('connect', onConnect);

    return () => {
      off('queue:updated', handleUpdate);
      off('queue:paused', handleUpdate);
      off('queue:resumed', handleUpdate);
      off('job:new', handleUpdate);
      off('job:complete', handleUpdate);
      off('job:error', handleUpdate);
      off('job:held', handleUpdate);
      off('job:released', handleUpdate);
      if (interval) clearInterval(interval);
      wsFallback?.off?.('disconnect', onDisconnect);
      wsFallback?.off?.('connect', onConnect);
    };
  }, [fetchAll]);

  const moveUp = async (q: any) => {
    if (q.position <= 0) return;
    setBusyId(`${q.id}-up`);
    try {
      await queues.reorder(q.id, q.position - 1);
      fetchAll();
    } catch (e: any) {
      alert(`Reorder failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const moveDown = async (q: any) => {
    setBusyId(`${q.id}-down`);
    try {
      await queues.reorder(q.id, q.position + 1);
      fetchAll();
    } catch (e: any) {
      alert(`Reorder failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const holdJob = async (jobId: string) => {
    if (!confirm(`Hold job ${jobId}?`)) return;
    setBusyId(`hold-${jobId}`);
    try {
      await jobsApi.hold(jobId);
      fetchAll();
    } catch (e: any) {
      alert(`Hold failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const releaseJob = async (jobId: string) => {
    setBusyId(`release-${jobId}`);
    try {
      await jobsApi.release(jobId);
      fetchAll();
    } catch (e: any) {
      alert(`Release failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const cancelJob = async (jobId: string) => {
    if (!confirm(`Cancel job ${jobId}? This action cannot be undone.`)) return;
    setBusyId(`cancel-${jobId}`);
    try {
      await jobsApi.cancel(jobId);
      fetchAll();
    } catch (e: any) {
      alert(`Cancel failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  // Group by printer
  const grouped = items.reduce((acc: Record<number, any[]>, item) => {
    if (!acc[item.printer_id]) acc[item.printer_id] = [];
    acc[item.printer_id].push(item);
    return acc;
  }, {});

  const statusOptions = ['', 'waiting', 'processing', 'paused', 'held'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 10, background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.cyan }}>
            <Layers size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontFamily: C.mono, fontSize: 22, color: C.text, letterSpacing: 1 }}>PRINT QUEUES</h1>
            <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
              {items.length} active jobs · {Object.keys(grouped).length} printers
            </span>
          </div>
        </div>
        <button onClick={fetchAll} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <Filter size={16} style={{ color: C.muted }} />
        <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Status:</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {statusOptions.map(s => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                background: statusFilter === s ? 'rgba(0,212,255,0.15)' : C.sec,
                border: `1px solid ${statusFilter === s ? 'rgba(0,212,255,0.4)' : C.border}`,
                color: statusFilter === s ? C.cyan : C.muted,
                fontFamily: C.sans, fontSize: 11, textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginLeft: 16 }}>Printer:</span>
        <select
          value={printerFilter}
          onChange={(e) => setPrinterFilter(e.target.value)}
          className="input"
          style={{ padding: '4px 8px', fontSize: 12, minWidth: 180, background: C.sec, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6 }}
        >
          <option value="">All Printers</option>
          {printers.map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && items.length === 0 && (
        <div style={{ minHeight: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Loader2 size={28} style={{ color: C.cyan, animation: 'spin 1s linear infinite' }} />
          <div style={{ color: C.muted, fontFamily: C.sans }}>Loading queues...</div>
        </div>
      )}

      {/* Empty */}
      {!loading && items.length === 0 && (
        <div className="card" style={{ padding: 60, textAlign: 'center', color: C.muted }}>
          <Layers size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
          <div style={{ fontFamily: C.sans, fontSize: 14 }}>No active jobs in the queue.</div>
          <div style={{ fontFamily: C.sans, fontSize: 12, marginTop: 6, opacity: 0.7 }}>
            Jobs waiting to print will appear here.
          </div>
        </div>
      )}

      {/* Grouped by printer */}
      {Object.entries(grouped).map(([printerId, queue]) => {
        const printer = printers.find((p: any) => p.id === Number(printerId));
        return (
          <div key={printerId} className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Link href={`/printers/${printerId}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
                <PrinterIcon size={18} style={{ color: C.cyan }} />
                <h3 style={{ margin: 0, fontFamily: C.sans, fontSize: 16, fontWeight: 700, color: C.text }}>
                  {printer?.name || `Printer #${printerId}`}
                </h3>
                <span style={{ fontFamily: C.mono, fontSize: 10, padding: '2px 8px', borderRadius: 4, background: C.sec, color: C.muted, border: `1px solid ${C.border}` }}>
                  {queue.length} job{queue.length !== 1 ? 's' : ''}
                </span>
              </Link>
            </div>

            {/* Mobile: card layout / Desktop: table */}
            <div className="desktop-only" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr 1fr 80px 100px 200px', padding: '8px 12px', borderBottom: `1px solid ${C.border}`, fontFamily: C.sans, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                <div>#</div>
                <div>Job</div>
                <div>File</div>
                <div>User</div>
                <div>Pages</div>
                <div>Status</div>
                <div>Actions</div>
              </div>
              {queue.map((q: any) => {
                const sb = statusBadge(q.status);
                return (
                  <div key={q.id} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr 1fr 80px 100px 200px', padding: '10px 12px', background: C.sec, borderRadius: 6, border: `1px solid ${C.border}`, alignItems: 'center', fontSize: 13 }}>
                    <div style={{ fontFamily: C.mono, color: C.muted, fontSize: 11 }}>{q.position}</div>
                    <Link href={`/jobs/${q.job_id}`} style={{ fontFamily: C.mono, fontSize: 11, color: C.cyan, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.job_id?.substring(0, 13)}…
                    </Link>
                    <div style={{ fontFamily: C.sans, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.file_name || q.job_name || '—'}
                    </div>
                    <div style={{ fontFamily: C.sans, color: C.muted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.username || '—'}
                    </div>
                    <div style={{ fontFamily: C.mono, fontSize: 12, color: C.text }}>
                      {q.pages || 0}p × {q.copies || 1}
                    </div>
                    <span style={{ fontFamily: C.mono, fontSize: 10, padding: '3px 8px', borderRadius: 4, color: sb.color, border: `1px solid ${sb.border}`, background: sb.bg, textTransform: 'uppercase', textAlign: 'center' }}>
                      {q.status}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => moveUp(q)}
                        disabled={q.position === 0 || busyId === `${q.id}-up`}
                        style={{ width: 24, height: 24, borderRadius: 4, background: C.sec, border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Move up"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={() => moveDown(q)}
                        disabled={busyId === `${q.id}-down`}
                        style={{ width: 24, height: 24, borderRadius: 4, background: C.sec, border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Move down"
                      >
                        <ChevronDown size={12} />
                      </button>
                      {q.status === 'held' ? (
                        <button
                          onClick={() => releaseJob(q.job_id)}
                          disabled={busyId === `release-${q.job_id}`}
                          style={{ width: 24, height: 24, borderRadius: 4, background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', color: C.green, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Release"
                        >
                          <Play size={12} />
                        </button>
                      ) : (
                        <button
                          onClick={() => holdJob(q.job_id)}
                          disabled={busyId === `hold-${q.job_id}`}
                          style={{ width: 24, height: 24, borderRadius: 4, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: C.amber, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Hold"
                        >
                          <Pause size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => cancelJob(q.job_id)}
                        disabled={busyId === `cancel-${q.job_id}`}
                        style={{ width: 24, height: 24, borderRadius: 4, background: 'rgba(255,61,90,0.1)', border: '1px solid rgba(255,61,90,0.3)', color: C.red, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Cancel"
                      >
                        <XCircle size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mobile card view */}
            <div className="mobile-only" style={{ display: 'none', flexDirection: 'column', gap: 8 }}>
              {queue.map((q: any) => {
                const sb = statusBadge(q.status);
                return (
                  <div key={`m-${q.id}`} style={{ padding: 12, background: C.sec, borderRadius: 8, border: `1px solid ${C.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted }}>Position #{q.position}</span>
                      <span style={{ fontFamily: C.mono, fontSize: 10, padding: '2px 6px', borderRadius: 4, color: sb.color, border: `1px solid ${sb.border}`, background: sb.bg, textTransform: 'uppercase' }}>
                        {q.status}
                      </span>
                    </div>
                    <div style={{ fontFamily: C.sans, fontSize: 13, color: C.text, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.file_name || q.job_name || '—'}
                    </div>
                    <Link href={`/jobs/${q.job_id}`} style={{ fontFamily: C.mono, fontSize: 10, color: C.cyan, textDecoration: 'none' }}>
                      {q.job_id?.substring(0, 16)}…
                    </Link>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => moveUp(q)} disabled={q.position === 0} style={{ flex: 1, padding: 6, background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11 }}>
                        <ChevronUp size={12} /> Up
                      </button>
                      <button onClick={() => moveDown(q)} style={{ flex: 1, padding: 6, background: C.card, border: `1px solid ${C.border}`, color: C.text, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11 }}>
                        <ChevronDown size={12} /> Down
                      </button>
                      <button onClick={() => q.status === 'held' ? releaseJob(q.job_id) : holdJob(q.job_id)} style={{ flex: 1, padding: 6, background: q.status === 'held' ? 'rgba(0,255,136,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${q.status === 'held' ? 'rgba(0,255,136,0.3)' : 'rgba(245,158,11,0.3)'}`, color: q.status === 'held' ? C.green : C.amber, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11 }}>
                        {q.status === 'held' ? <Play size={12} /> : <Pause size={12} />}
                        {q.status === 'held' ? 'Release' : 'Hold'}
                      </button>
                      <button onClick={() => cancelJob(q.job_id)} style={{ flex: 1, padding: 6, background: 'rgba(255,61,90,0.1)', border: '1px solid rgba(255,61,90,0.3)', color: C.red, borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 11 }}>
                        <XCircle size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

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
