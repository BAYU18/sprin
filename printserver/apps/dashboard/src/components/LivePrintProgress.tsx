'use client';

import { useEffect, useState } from 'react';
import { on, off } from '@/hooks/useSocket';
import { Loader2, CheckCircle2, XCircle, Pause } from 'lucide-react';

const C = {
  cyan: 'var(--accent-cyan)',
  green: 'var(--accent-green)',
  red: '#ff3d5a',
  amber: 'var(--accent-amber)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  border: 'var(--border)',
  card: 'var(--bg-card)',
  sec: 'var(--bg-secondary)',
  mono: "'Share Tech Mono', monospace",
  sans: "'Rajdhani', sans-serif",
};

type ProgressEvent = {
  job_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'held';
  pages_printed: number;
  total_pages: number;
  current_page: number;
  copies_done: number;
  total_copies: number;
  printer_name?: string;
  printer_id?: number;
  started_at?: string;
  completed_at?: string;
  estimated_completion?: string;
  error?: string;
};

export default function LivePrintProgress({ jobId, initialData }: { jobId: string; initialData?: any }) {
  const [progress, setProgress] = useState<ProgressEvent | null>(() => {
    if (!initialData) return null;
    return {
      job_id: jobId,
      status: initialData.status || 'queued',
      pages_printed: initialData.pages_printed || 0,
      total_pages: initialData.total_pages || initialData.pages || 0,
      current_page: initialData.current_page || 0,
      copies_done: initialData.copies_done || 0,
      total_copies: initialData.copies || 1,
      printer_name: initialData.printer_name,
      printer_id: initialData.printer_id,
    };
  });

  useEffect(() => {
    if (!jobId) return;
    const handler = (data: any) => {
      if (data?.job_id === jobId) {
        setProgress((prev) => ({ ...(prev || {} as any), ...data, job_id: jobId }));
      }
    };
    on('job:progress', handler);
    on('job:status', handler);
    on('job:complete', handler);
    on('job:error', handler);
    return () => {
      off('job:progress', handler);
      off('job:status', handler);
      off('job:complete', handler);
      off('job:error', handler);
    };
  }, [jobId]);

  if (!progress) return null;

  const isLive = progress.status === 'processing';
  const isDone = progress.status === 'completed';
  const isFailed = progress.status === 'failed' || progress.status === 'cancelled';
  const isHeld = progress.status === 'held';

  // Calculate total progress
  const totalUnits = Math.max(1, progress.total_pages * progress.total_copies);
  const completedUnits =
    (progress.pages_printed > 0 ? progress.pages_printed : progress.current_page) * progress.total_copies +
    progress.copies_done;
  const pct = Math.min(100, Math.max(0, (completedUnits / totalUnits) * 100));

  const startTs = progress.started_at ? new Date(progress.started_at).getTime() : null;
  const elapsedSec = startTs ? Math.floor((Date.now() - startTs) / 1000) : 0;

  // ETA: simple linear projection
  let etaText = '—';
  if (isLive && pct > 0 && pct < 100) {
    const remainingSec = Math.floor((elapsedSec / pct) * (100 - pct));
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    etaText = m > 0 ? `~${m}m ${s}s` : `~${s}s`;
  } else if (isDone) {
    etaText = 'Done';
  } else if (isFailed) {
    etaText = progress.error || progress.status;
  }

  const barColor = isFailed ? C.red : isDone ? C.green : isHeld ? C.amber : C.cyan;

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isLive && <Loader2 size={18} style={{ color: C.cyan, animation: 'spin 1s linear infinite' }} />}
          {isDone && <CheckCircle2 size={18} style={{ color: C.green }} />}
          {isFailed && <XCircle size={18} style={{ color: C.red }} />}
          {isHeld && <Pause size={18} style={{ color: C.amber }} />}
          {!isLive && !isDone && !isFailed && !isHeld && <Loader2 size={18} style={{ color: C.muted }} />}
          <div>
            <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
              {isLive ? 'PRINTING NOW' : isDone ? 'COMPLETED' : isFailed ? 'FAILED' : isHeld ? 'HELD' : 'QUEUED'}
            </div>
            {progress.printer_name && (
              <div style={{ fontFamily: C.sans, fontSize: 11, color: C.muted, marginTop: 2 }}>
                on {progress.printer_name}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: C.mono, fontSize: 22, color: barColor, fontWeight: 700, lineHeight: 1 }}>
            {pct.toFixed(0)}%
          </div>
          <div style={{ fontFamily: C.mono, fontSize: 10, color: C.muted, marginTop: 2 }}>
            ETA {etaText}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ position: 'relative', width: '100%', height: 12, background: C.sec, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}` }}>
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, bottom: 0,
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${barColor}88, ${barColor})`,
            transition: 'width 0.4s ease-out',
            boxShadow: isLive ? `0 0 12px ${barColor}` : 'none',
          }}
        />
        {isLive && (
          <div
            style={{
              position: 'absolute',
              top: 0, left: 0, bottom: 0,
              width: `${pct}%`,
              background: `linear-gradient(90deg, transparent, ${barColor}44, transparent)`,
              animation: 'shimmer 1.5s linear infinite',
            }}
          />
        )}
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 14 }}>
        <div>
          <div style={{ fontFamily: C.sans, fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Pages</div>
          <div style={{ fontFamily: C.mono, fontSize: 14, color: C.text, fontWeight: 600 }}>
            {progress.current_page || 0} / {progress.total_pages || 0}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: C.sans, fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Copies</div>
          <div style={{ fontFamily: C.mono, fontSize: 14, color: C.text, fontWeight: 600 }}>
            {progress.copies_done || 0} / {progress.total_copies || 0}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: C.sans, fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Elapsed</div>
          <div style={{ fontFamily: C.mono, fontSize: 14, color: C.text, fontWeight: 600 }}>
            {Math.floor(elapsedSec / 60)}m {elapsedSec % 60}s
          </div>
        </div>
        <div>
          <div style={{ fontFamily: C.sans, fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>Status</div>
          <div style={{ fontFamily: C.mono, fontSize: 12, color: barColor, fontWeight: 600, textTransform: 'uppercase' }}>
            {progress.status}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
      `}</style>
    </div>
  );
}
