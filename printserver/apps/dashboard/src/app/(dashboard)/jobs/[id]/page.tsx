'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { jobs as jobsApi } from '@/lib/api';
import { on, off, getSocket } from '@/hooks/useSocket';
import LivePrintProgress from '@/components/LivePrintProgress';
import {
  ArrowLeft, FileText, XCircle, Hash, Clock, CheckCircle2,
  Loader2, RefreshCw, Activity, Server, User, HardDrive,
  RotateCcw, Pause, Play, AlertTriangle, Calendar,
  ChevronRight, Layers, Timer, Cpu, FileType, FolderOpen,
  Smartphone
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

// ── Status colour helper (matches the jobs list page) ──────────────────────
const statusStyles: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  queued:     { dot: '#f59e0b', bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.35)' },
  processing: { dot: '#00d4ff', bg: 'rgba(0,212,255,0.12)',  text: '#00d4ff', border: 'rgba(0,212,255,0.35)'  },
  completed:  { dot: '#00ff88', bg: 'rgba(0,255,136,0.12)',  text: '#00ff88', border: 'rgba(0,255,136,0.35)'  },
  failed:     { dot: '#ff3d5a', bg: 'rgba(255,61,90,0.12)',  text: '#ff3d5a', border: 'rgba(255,61,90,0.35)'  },
  cancelled:  { dot: '#ff3d5a', bg: 'rgba(255,61,90,0.08)',  text: '#ff3d5a', border: 'rgba(255,61,90,0.25)'  },
  held:       { dot: '#f59e0b', bg: 'rgba(245,158,11,0.10)', text: '#f59e0b', border: 'rgba(245,158,11,0.30)' },
};

// Per-event-type colour (for the timeline dots/lines)
const eventStyles: Record<string, { color: string; bg: string; label: string }> = {
  queued:             { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'QUEUED' },
  processing:         { color: '#00d4ff', bg: 'rgba(0,212,255,0.12)',  label: 'PROCESSING' },
  completed:          { color: '#00ff88', bg: 'rgba(0,255,136,0.12)',  label: 'COMPLETED' },
  failed:             { color: '#ff3d5a', bg: 'rgba(255,61,90,0.12)',  label: 'FAILED' },
  cancelled:          { color: '#ff3d5a', bg: 'rgba(255,61,90,0.08)',  label: 'CANCELLED' },
  retry_attempt:      { color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', label: 'RETRY' },
  attempt_failed:     { color: '#ff3d5a', bg: 'rgba(255,61,90,0.12)',  label: 'ATTEMPT FAILED' },
  attempt_succeeded:  { color: '#00ff88', bg: 'rgba(0,255,136,0.12)',  label: 'ATTEMPT OK' },
};

function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || isNaN(Number(bytes))) return '—';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function truncateMiddle(s: string, max = 16): string {
  if (!s || s.length <= max) return s || '';
  const half = Math.floor((max - 1) / 2);
  return `${s.slice(0, half)}…${s.slice(-half)}`;
}

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = String(params?.id || '');

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState<number>(Date.now());

  const fetchDetail = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await jobsApi.get(jobId);
      setData(res.data);
      setNotFound(false);
    } catch (e: any) {
      if (e?.response?.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) { setNotFound(true); setLoading(false); return; }
    fetchDetail();

    // Live updates — only react to events for THIS job.
    const handleJobUpdate = (payload: any) => {
      if (!payload) return;
      if (payload.jobId && payload.jobId !== jobId) return;
      fetchDetail();
    };
    on('job:complete', handleJobUpdate);
    on('job:error', handleJobUpdate);
    on('job:new', handleJobUpdate);
    on('job:held', handleJobUpdate);
    on('job:released', handleJobUpdate);
    on('job:retry', handleJobUpdate);

    // Tick "X seconds ago" once a second
    const tick = setInterval(() => setNow(Date.now()), 1000);

    // WS-fallback polling (15s) — only when socket is disconnected.
    const sock: any = getSocket();
    let poll: any = null;
    const onDisconnect = () => { if (!poll) poll = setInterval(fetchDetail, 15000); };
    const onConnect = () => { if (poll) { clearInterval(poll); poll = null; } };
    if (sock && !sock.connected) onDisconnect();
    sock?.on?.('disconnect', onDisconnect);
    sock?.on?.('connect', onConnect);

    return () => {
      off('job:complete', handleJobUpdate);
      off('job:error', handleJobUpdate);
      off('job:new', handleJobUpdate);
      off('job:held', handleJobUpdate);
      off('job:released', handleJobUpdate);
      off('job:retry', handleJobUpdate);
      clearInterval(tick);
      if (poll) clearInterval(poll);
      sock?.off?.('disconnect', onDisconnect);
      sock?.off?.('connect', onConnect);
    };
  }, [jobId, fetchDetail]);

  const C = {
    cyan: 'var(--accent-cyan)', green: 'var(--accent-green)', amber: 'var(--accent-amber)',
    red: '#ff3d5a', purple: '#a78bfa', muted: 'var(--text-muted)', text: 'var(--text-primary)',
    border: 'var(--border)', card: 'var(--bg-card)', sec: 'var(--bg-secondary)',
    mono: "'Share Tech Mono', monospace", sans: "'Rajdhani', sans-serif",
  };

  // ── Action handlers ───────────────────────────────────────────────────────
  const doAction = async (kind: 'cancel' | 'hold' | 'release' | 'retry', fn: () => Promise<any>) => {
    if (actionLoading[kind]) return;
    setActionLoading(prev => ({ ...prev, [kind]: true }));
    try {
      await fn();
      await fetchDetail();
    } catch (e: any) {
      alert(`${kind} failed: ${e?.response?.data?.error || e?.message || 'unknown error'}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [kind]: false }));
    }
  };

  const handleCancel = () => doAction('cancel', () => jobsApi.cancel(jobId));
  const handleHold    = () => doAction('hold',    () => jobsApi.hold(jobId));
  const handleRelease = () => doAction('release', () => jobsApi.release(jobId));
  const handleRetry   = () => doAction('retry',   () => jobsApi.retry(jobId));

  // ── Loading / not-found states ────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Loader2 size={28} style={{ color: C.cyan, animation: 'spin 1s linear infinite' }} />
        <div style={{ color: C.muted, fontFamily: C.sans }}>Loading job details…</div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <XCircle size={40} style={{ color: C.red }} />
        <h2 style={{ fontFamily: C.mono, color: C.text, margin: 0 }}>JOB NOT FOUND</h2>
        <Link href="/jobs" style={{ textDecoration: 'none' }}>
          <button className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <ArrowLeft size={16} /> Back to Jobs
          </button>
        </Link>
      </div>
    );
  }

  // ── Derived values ────────────────────────────────────────────────────────
  const status: string = (data.status || 'queued').toLowerCase();
  const sty = statusStyles[status] || statusStyles.queued;

  const attempts: any[] = Array.isArray(data.attempts_history) ? data.attempts_history : [];
  const events: any[] = Array.isArray(data.events) ? data.events : [];

  const printer = data.printer_details || (data.printer_id ? {
    id: data.printer_id, name: data.printer_name, slug: data.printer_slug,
    status: data.printer_status, type: data.printer_type, driver_id: data.printer_driver_id,
  } : null);
  const user = data.user_details || (data.user_id ? {
    id: data.user_id, username: data.username, full_name: data.full_name, department: data.department,
  } : null);

  // Compute duration
  let durationMs: number | null = null;
  if (data.started_at && data.completed_at) {
    durationMs = new Date(data.completed_at).getTime() - new Date(data.started_at).getTime();
  } else if (data.started_at && (status === 'processing' || status === 'queued')) {
    durationMs = now - new Date(data.started_at).getTime();
  } else if (!data.started_at && data.created_at && (status === 'queued')) {
    durationMs = now - new Date(data.created_at).getTime();
  }

  const totalPages = (data.pages || 0) * (data.copies || 1);
  const fileSizeBytes = data.file_size_bytes || data.file_size || null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Live Print Progress (only for active jobs) ───────────── */}
      {(data.status === 'queued' || data.status === 'processing') && (
        <LivePrintProgress
          jobId={data.job_id || data.id}
          initialData={{
            status: data.status,
            pages_printed: data.pages_printed,
            total_pages: data.total_pages || data.pages,
            current_page: data.current_page,
            copies_done: data.copies_done,
            copies: data.copies,
            printer_name: data.printer_name,
            printer_id: data.printer_id,
            started_at: data.started_at,
          }}
        />
      )}

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link
            href="/jobs"
            style={{
              background: C.sec, border: `1px solid ${C.border}`, borderRadius: 8,
              width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.muted, cursor: 'pointer', textDecoration: 'none',
            }}
            title="Back to jobs"
          >
            <ArrowLeft size={18} />
          </Link>
          <div
            style={{
              width: 46, height: 46, borderRadius: 10,
              background: sty.bg, border: `1px solid ${sty.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: sty.text, boxShadow: `0 0 16px ${sty.border}`,
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <h1
              style={{
                margin: 0, fontFamily: C.mono, fontSize: 20, color: C.text,
                letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: 480,
              }}
              title={data.file_name || data.job_name || 'Print job'}
            >
              {data.file_name || data.job_name || 'Print job'}
            </h1>
            <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
              Job #{data.id} · {truncateMiddle(data.job_id || '', 24)}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: C.mono, fontSize: 11, padding: '4px 12px', borderRadius: 6,
              background: sty.bg, color: sty.text, border: `1px solid ${sty.border}`,
              textTransform: 'uppercase', letterSpacing: 1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span
              style={{
                width: 6, height: 6, borderRadius: '50%', background: sty.dot,
                boxShadow: `0 0 6px ${sty.dot}`,
                animation: status === 'processing' ? 'statusPulse 1.2s ease-in-out infinite' : undefined,
              }}
            />
            {status}
          </span>

          <button
            onClick={fetchDetail}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <RefreshCw size={15} /> Refresh
          </button>

          {/* Contextual action buttons (TIER-1 #1 spec) */}
          {status === 'queued' && (
            <button
              onClick={handleHold}
              disabled={actionLoading.hold}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
                color: C.amber, cursor: actionLoading.hold ? 'wait' : 'pointer',
                fontFamily: C.sans, fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                opacity: actionLoading.hold ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(245,158,11,0.12)'; }}
            >
              {actionLoading.hold ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Pause size={14} />}
              Hold
            </button>
          )}

          {status === 'held' && (
            <button
              onClick={handleRelease}
              disabled={actionLoading.release}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'rgba(0,255,136,0.12)', border: '1px solid rgba(0,255,136,0.3)',
                color: C.green, cursor: actionLoading.release ? 'wait' : 'pointer',
                fontFamily: C.sans, fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                opacity: actionLoading.release ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,255,136,0.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,255,136,0.12)'; }}
            >
              {actionLoading.release ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
              Release
            </button>
          )}

          {status === 'failed' && (
            <button
              onClick={handleRetry}
              disabled={actionLoading.retry}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.3)',
                color: C.cyan, cursor: actionLoading.retry ? 'wait' : 'pointer',
                fontFamily: C.sans, fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                opacity: actionLoading.retry ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,212,255,0.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,212,255,0.12)'; }}
            >
              {actionLoading.retry ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={14} />}
              Retry
            </button>
          )}

          {['queued', 'processing', 'held'].includes(status) && (
            <button
              onClick={handleCancel}
              disabled={actionLoading.cancel}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8,
                background: 'rgba(255,61,90,0.12)', border: '1px solid rgba(255,61,90,0.3)',
                color: C.red, cursor: actionLoading.cancel ? 'wait' : 'pointer',
                fontFamily: C.sans, fontSize: 13, fontWeight: 600, transition: 'all 0.2s',
                opacity: actionLoading.cancel ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,61,90,0.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,61,90,0.12)'; }}
            >
              {actionLoading.cancel ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <XCircle size={14} />}
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── Stat cards row ──────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {[
          { label: 'Job ID',    value: truncateMiddle(data.job_id || '', 12) || '—',     color: C.cyan,    icon: <Hash size={16} />, mono: true },
          { label: 'Status',    value: status.toUpperCase(),                              color: sty.text,  icon: <Activity size={16} /> },
          { label: 'Pages',     value: `${data.pages || 0}`,                              color: C.text,    icon: <FileText size={16} /> },
          { label: 'Copies',    value: `${data.copies || 1}`,                             color: C.text,    icon: <Layers size={16} /> },
          { label: 'Created',   value: data.created_at ? format(new Date(data.created_at), 'dd MMM HH:mm') : '—', color: C.text, icon: <Calendar size={16} />, mono: true },
          { label: 'Duration',  value: fmtDuration(durationMs),                          color: C.amber,   icon: <Timer size={16} />, mono: true },
        ].map((s, i) => (
          <div
            key={i}
            style={{
              padding: 14, borderRadius: 8, background: C.sec, border: `1px solid ${C.border}`,
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.muted, fontFamily: C.sans, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              <span style={{ color: C.muted }}>{s.icon}</span>
              {s.label}
            </div>
            <div
              style={{
                fontFamily: s.mono ? C.mono : C.sans, fontSize: s.mono ? 14 : 18,
                color: s.color, fontWeight: s.mono ? 600 : 700,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              title={String(s.value)}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Two-column grid: Job Info + Retry History ──────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* LEFT — Job Info */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={16} style={{ color: C.amber }} /> Job Info
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* Printer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <Server size={14} /> Printer
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {printer && printer.id ? (
                  <Link href={printer.slug ? `/printers/${printer.slug}` : `/printers/${printer.id}`} style={{ color: C.cyan, textDecoration: 'none' }}>
                    {printer.name || `Printer #${printer.id}`}
                  </Link>
                ) : 'N/A'}
              </span>
            </div>

            {/* User */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <User size={14} /> User
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user ? (
                  <>
                    {user.username || '—'}
                    {user.full_name && user.full_name !== user.username && (
                      <span style={{ color: C.muted, marginLeft: 6, fontSize: 11 }}>({user.full_name})</span>
                    )}
                  </>
                ) : 'N/A'}
              </span>
            </div>

            {/* Client */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <HardDrive size={14} /> Client
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text }}>
                {data.client_id ? (
                  <Link href={`/clients/${data.client_id}`} style={{ color: C.cyan, textDecoration: 'none' }}>
                    {data.client_hostname || `Client #${data.client_id}`}
                  </Link>
                ) : 'N/A'}
              </span>
            </div>

            {/* File name */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <FileText size={14} /> File Name
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.file_name || ''}>
                {data.file_name || '—'}
              </span>
            </div>

            {/* File path */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <FolderOpen size={14} /> File Path
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 12, color: C.muted, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.file_path || ''}>
                {data.file_path || '—'}
              </span>
            </div>

            {/* File type */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <FileType size={14} /> File Type
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text }}>
                {data.file_type || '—'}
              </span>
            </div>

            {/* File size */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <HardDrive size={14} /> File Size
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text }}>
                {fmtBytes(fileSizeBytes)}
              </span>
            </div>

            {/* Source app */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <Cpu size={14} /> Source App
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.source_app || ''}>
                {data.source_app || '—'}
              </span>
            </div>

            {/* Source device */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <Smartphone size={14} /> Source Device
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text, textAlign: 'right', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={data.source_device || ''}>
                {data.source_device || '—'}
              </span>
            </div>

            {/* Document format */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <FileType size={14} /> Document Format
              </span>
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text }}>
                {data.document_format || data.converted_format || '—'}
              </span>
            </div>
          </div>

          {/* Error message (if any) */}
          {data.error_message && (
            <div
              style={{
                marginTop: 16, padding: 12, borderRadius: 8,
                background: 'rgba(255,61,90,0.08)', border: '1px solid rgba(255,61,90,0.3)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
              }}
            >
              <AlertTriangle size={16} style={{ color: C.red, flexShrink: 0, marginTop: 2 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: C.sans, fontSize: 11, color: C.red, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 4 }}>
                  Error Message
                </div>
                <div style={{ fontFamily: C.mono, fontSize: 12, color: C.text, wordBreak: 'break-word' }}>
                  {data.error_message}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — Retry History */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <RotateCcw size={16} style={{ color: C.purple }} /> Retry History
            {attempts.length > 0 && (
              <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: 11, color: C.muted, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
              </span>
            )}
          </h3>

          {attempts.length === 0 ? (
            <div
              style={{
                padding: 24, textAlign: 'center', color: C.muted, fontFamily: C.sans, fontSize: 13,
                border: `1px dashed ${C.border}`, borderRadius: 8,
              }}
            >
              <CheckCircle2 size={28} style={{ color: C.green, marginBottom: 8 }} />
              <div>No retries — job {status === 'completed' ? 'completed cleanly' : 'has not retried'}.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
              {attempts.map((a: any, i: number) => {
                const attemptStatus: string = (a.status || 'pending').toLowerCase();
                const aSty = statusStyles[attemptStatus] || statusStyles.queued;
                const isLast = i === attempts.length - 1;
                return (
                  <div key={a.id ?? i} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 16 }}>
                    {/* Vertical line connector */}
                    {!isLast && (
                      <div
                        style={{
                          position: 'absolute',
                          left: 11, top: 22, bottom: 0,
                          width: 1,
                          background: C.border,
                        }}
                      />
                    )}
                    {/* Dot */}
                    <div
                      style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: aSty.bg, border: `1px solid ${aSty.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: aSty.text, flexShrink: 0, zIndex: 1,
                      }}
                    >
                      <RotateCcw size={10} />
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: C.mono, fontSize: 12, color: C.text, fontWeight: 600 }}>
                          Attempt #{a.attempt_number ?? '?'}
                        </span>
                        <span
                          style={{
                            fontFamily: C.sans, fontSize: 10, padding: '2px 6px', borderRadius: 4,
                            background: aSty.bg, color: aSty.text, border: `1px solid ${aSty.border}`,
                            textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700,
                          }}
                        >
                          {attemptStatus}
                        </span>
                        {a.duration_ms != null && (
                          <span style={{ fontFamily: C.mono, fontSize: 11, color: C.muted }}>
                            · {fmtDuration(a.duration_ms)}
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {/* Printer used */}
                        {a.printer && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <Server size={11} style={{ color: C.muted }} />
                            <span style={{ fontFamily: C.sans, color: C.muted }}>Printer:</span>
                            {a.printer.slug ? (
                              <Link href={`/printers/${a.printer.slug}`} style={{ fontFamily: C.mono, color: C.cyan, textDecoration: 'none', fontSize: 12 }}>
                                {a.printer.name || `Printer #${a.printer.id}`}
                              </Link>
                            ) : (
                              <span style={{ fontFamily: C.mono, color: C.text, fontSize: 12 }}>
                                {a.printer.name || `Printer #${a.printer.id}`}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Reason */}
                        {a.reason && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <AlertTriangle size={11} style={{ color: C.amber }} />
                            <span style={{ fontFamily: C.sans, color: C.muted }}>Reason:</span>
                            <span style={{ fontFamily: C.mono, color: C.text, fontSize: 12 }}>{a.reason}</span>
                          </div>
                        )}

                        {/* Error message */}
                        {a.error_message && (
                          <div
                            style={{
                              fontFamily: C.mono, fontSize: 11, color: C.red,
                              background: 'rgba(255,61,90,0.06)', border: '1px solid rgba(255,61,90,0.2)',
                              borderRadius: 4, padding: '6px 8px', marginTop: 2,
                              wordBreak: 'break-word',
                            }}
                          >
                            {a.error_message}
                          </div>
                        )}

                        {/* Timestamps */}
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                          {a.created_at && (
                            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted }}>
                              created: {format(new Date(a.created_at), 'dd MMM HH:mm:ss')}
                            </span>
                          )}
                          {a.started_at && (
                            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted }}>
                              started: {format(new Date(a.started_at), 'dd MMM HH:mm:ss')}
                            </span>
                          )}
                          {a.completed_at && (
                            <span style={{ fontFamily: C.mono, fontSize: 10, color: C.muted }}>
                              completed: {format(new Date(a.completed_at), 'dd MMM HH:mm:ss')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Event Timeline (full width) ─────────────────────────────── */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Activity size={16} style={{ color: C.cyan }} /> Event Timeline
          {events.length > 0 && (
            <span style={{ marginLeft: 'auto', fontFamily: C.mono, fontSize: 11, color: C.muted, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              {events.length} event{events.length === 1 ? '' : 's'}
            </span>
          )}
        </h3>

        {events.length === 0 ? (
          <div
            style={{
              padding: 24, textAlign: 'center', color: C.muted, fontFamily: C.sans, fontSize: 13,
              border: `1px dashed ${C.border}`, borderRadius: 8,
            }}
          >
            <Clock size={28} style={{ color: C.muted, marginBottom: 8 }} />
            <div>No events recorded yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            {events.map((e: any, i: number) => {
              const eSty = eventStyles[e.type] || { color: C.muted, bg: 'rgba(128,128,128,0.1)', label: (e.type || 'event').toUpperCase() };
              const isLast = i === events.length - 1;
              const ts = e.timestamp ? new Date(e.timestamp) : null;
              return (
                <div key={i} style={{ display: 'flex', gap: 12, position: 'relative', paddingBottom: isLast ? 0 : 14 }}>
                  {/* Connector line */}
                  {!isLast && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 9, top: 20, bottom: 0,
                        width: 1,
                        background: C.border,
                      }}
                    />
                  )}
                  {/* Dot */}
                  <div
                    style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: eSty.bg, border: `1px solid ${eSty.color}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 0 6px ${eSty.color}55`,
                      flexShrink: 0, zIndex: 1,
                    }}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: eSty.color }} />
                  </div>

                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        fontFamily: C.sans, fontSize: 10, padding: '2px 8px', borderRadius: 4,
                        background: eSty.bg, color: eSty.color, border: `1px solid ${eSty.color}55`,
                        textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 700, flexShrink: 0,
                      }}
                    >
                      {eSty.label}
                    </span>
                    <span style={{ fontFamily: C.sans, fontSize: 13, color: C.text, flex: 1, minWidth: 0 }}>
                      {e.message}
                    </span>
                    {ts && (
                      <span style={{ fontFamily: C.mono, fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }} title={ts.toISOString()}>
                        {format(ts, 'dd MMM HH:mm:ss')}
                        <span style={{ color: C.muted, marginLeft: 4 }}>· {formatDistanceToNow(ts, { addSuffix: true })}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
