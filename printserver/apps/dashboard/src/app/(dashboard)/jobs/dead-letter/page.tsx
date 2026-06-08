'use client';

import { useEffect, useState, useCallback } from 'react';
import { jobs as jobsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  AlertTriangle, RefreshCw, RotateCcw, Trash2, XCircle,
  ChevronDown, ChevronRight, Clock, Loader2, Inbox
} from 'lucide-react';
import { format } from 'date-fns';

interface RetryRecord {
  print_job_id: number;
  attempt_number: number;
  status: string;
  error_message: string | null;
  created_at: string;
}

interface DeadJob {
  id: number;
  job_id: string;
  file_name: string | null;
  status: string;
  attempts: number;
  error_message: string | null;
  copies: number;
  created_at: string;
  updated_at: string;
  printer_name: string | null;
  user_name: string | null;
  retries: RetryRecord[];
}

export default function DeadLetterPage() {
  const [jobs, setJobs] = useState<DeadJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const fetchJobs = useCallback(async () => {
    try {
      const res = await jobsApi.deadLetter.list();
      if (res?.data) {
        setJobs(res.data.jobs || []);
        setTotal(res.data.total || 0);
      }
    } catch (e) {
      console.error('Failed to fetch dead-letter jobs', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Live refresh when the queue changes
  useEffect(() => {
    const handler = () => fetchJobs();
    on('deadletter:changed', handler);
    on('job:error', handler);
    return () => {
      off('deadletter:changed', handler);
      off('job:error', handler);
    };
  }, [fetchJobs]);

  const toggleSelect = (jobId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  };

  const toggleExpand = (jobId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(jobId) ? next.delete(jobId) : next.add(jobId);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === jobs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(jobs.map(j => j.job_id)));
    }
  };

  const doRequeue = async (jobIds?: string[]) => {
    setBusy(true);
    try {
      const res = await jobsApi.deadLetter.requeue(jobIds);
      showToast(`✓ ${res.data.requeued} job di-requeue ke antrian cetak`);
      setSelected(new Set());
      await fetchJobs();
    } catch (e) {
      showToast('✗ Gagal requeue job');
    } finally {
      setBusy(false);
    }
  };

  const doDiscard = async (jobIds?: string[]) => {
    const count = jobIds?.length || total;
    if (!confirm(`Buang ${count} job gagal dari dead-letter? Job akan ditandai cancelled.`)) return;
    setBusy(true);
    try {
      const res = await jobsApi.deadLetter.discard(jobIds);
      showToast(`✓ ${res.data.discarded} job dibuang`);
      setSelected(new Set());
      await fetchJobs();
    } catch (e) {
      showToast('✗ Gagal membuang job');
    } finally {
      setBusy(false);
    }
  };

  const selectedArr = Array.from(selected);

  return (
    <div style={{ padding: '0 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '28px', fontWeight: 700, margin: 0 }}>
            <AlertTriangle style={{ color: '#ff3d5a' }} size={28} />
            Dead Letter Queue
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '6px', fontSize: '14px' }}>
            Job yang gagal cetak setelah semua retry & failover habis. Requeue untuk coba lagi, atau buang.
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchJobs(); }}
          className="btn-secondary"
          disabled={loading}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
        >
          <RefreshCw size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Bulk action bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '12px', marginBottom: '16px',
        padding: '12px 16px', borderRadius: '10px',
        background: 'rgba(255,61,90,0.06)', border: '1px solid rgba(255,61,90,0.2)'
      }}>
        <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
          <strong style={{ color: '#ff3d5a', fontSize: '18px' }}>{total}</strong> job gagal permanen
          {selected.size > 0 && <span> · {selected.size} dipilih</span>}
        </span>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {selected.size > 0 ? (
            <>
              <button onClick={() => doRequeue(selectedArr)} disabled={busy} className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                <RotateCcw size={15} /> Requeue ({selected.size})
              </button>
              <button onClick={() => doDiscard(selectedArr)} disabled={busy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                  padding: '8px 14px', borderRadius: '8px', border: '1px solid rgba(255,61,90,0.4)',
                  background: 'rgba(255,61,90,0.1)', color: '#ff3d5a', fontWeight: 600 }}>
                <Trash2 size={15} /> Buang ({selected.size})
              </button>
            </>
          ) : (
            <>
              <button onClick={() => doRequeue()} disabled={busy || total === 0} className="btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: total === 0 ? 'not-allowed' : 'pointer', opacity: total === 0 ? 0.5 : 1 }}>
                <RotateCcw size={15} /> Requeue Semua
              </button>
              <button onClick={() => doDiscard()} disabled={busy || total === 0}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
                  cursor: total === 0 ? 'not-allowed' : 'pointer', opacity: total === 0 ? 0.5 : 1,
                  padding: '8px 14px', borderRadius: '8px', border: '1px solid rgba(255,61,90,0.4)',
                  background: 'rgba(255,61,90,0.1)', color: '#ff3d5a', fontWeight: 600 }}>
                <Trash2 size={15} /> Buang Semua
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '60px', color: 'var(--text-muted)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Memuat...
        </div>
      ) : jobs.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '80px 20px', color: 'var(--text-muted)' }}>
          <Inbox size={48} style={{ opacity: 0.4 }} />
          <p style={{ fontSize: '16px', fontWeight: 600 }}>Tidak ada job gagal</p>
          <p style={{ fontSize: '13px' }}>Semua job cetak berjalan lancar. 🎉</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Select-all row */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)', cursor: 'pointer', paddingLeft: '4px' }}>
            <input type="checkbox" checked={selected.size === jobs.length && jobs.length > 0} onChange={selectAll} style={{ cursor: 'pointer' }} />
            Pilih semua di halaman ini
          </label>

          {jobs.map(job => {
            const isExpanded = expanded.has(job.job_id);
            const isSelected = selected.has(job.job_id);
            return (
              <div key={job.job_id} style={{
                borderRadius: '10px',
                border: `1px solid ${isSelected ? 'rgba(0,212,255,0.5)' : 'rgba(255,255,255,0.08)'}`,
                background: isSelected ? 'rgba(0,212,255,0.04)' : 'var(--card-bg, rgba(255,255,255,0.02))',
                overflow: 'hidden'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 16px' }}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(job.job_id)} style={{ marginTop: '3px', cursor: 'pointer' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: '15px' }}>{job.file_name || '(tanpa nama)'}</span>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: 'rgba(255,61,90,0.12)', color: '#ff3d5a', border: '1px solid rgba(255,61,90,0.35)' }}>
                        {job.attempts}x gagal
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <span>🖨 {job.printer_name || '—'}</span>
                      <span>👤 {job.user_name || '—'}</span>
                      <span>📄 {job.copies} salinan</span>
                      <span><Clock size={11} style={{ display: 'inline', verticalAlign: 'middle' }} /> {format(new Date(job.updated_at), 'dd MMM HH:mm')}</span>
                    </div>
                    {job.error_message && (
                      <div style={{ marginTop: '8px', fontSize: '12px', color: '#fca5a5', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                        ⚠ {job.error_message}
                      </div>
                    )}
                    {job.retries.length > 0 && (
                      <button onClick={() => toggleExpand(job.job_id)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginTop: '8px',
                          background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', padding: 0 }}>
                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        Riwayat retry ({job.retries.length})
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => doRequeue([job.job_id])} disabled={busy} title="Requeue job ini"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                        padding: '6px 10px', borderRadius: '7px', border: '1px solid rgba(0,212,255,0.4)',
                        background: 'rgba(0,212,255,0.1)', color: '#00d4ff', fontSize: '12px', fontWeight: 600 }}>
                      <RotateCcw size={13} /> Requeue
                    </button>
                    <button onClick={() => doDiscard([job.job_id])} disabled={busy} title="Buang job ini"
                      style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
                        padding: '6px 8px', borderRadius: '7px', border: '1px solid rgba(255,61,90,0.4)',
                        background: 'rgba(255,61,90,0.1)', color: '#ff3d5a' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Retry history */}
                {isExpanded && job.retries.length > 0 && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 16px 12px 44px', background: 'rgba(0,0,0,0.15)' }}>
                    {job.retries.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', fontSize: '12px', padding: '4px 0' }}>
                        <span style={{ color: '#00d4ff', fontWeight: 600, minWidth: '70px' }}>Attempt {r.attempt_number}</span>
                        <span style={{ padding: '1px 7px', borderRadius: '5px', fontSize: '11px',
                          background: r.status === 'exhausted' ? 'rgba(255,61,90,0.12)' : 'rgba(245,158,11,0.12)',
                          color: r.status === 'exhausted' ? '#ff3d5a' : '#f59e0b' }}>{r.status}</span>
                        <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-word' }}>{r.error_message || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 1000,
          padding: '12px 20px', borderRadius: '10px',
          background: 'var(--card-bg, #1a1a2e)', border: '1px solid rgba(0,212,255,0.4)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', fontSize: '14px', fontWeight: 500
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
