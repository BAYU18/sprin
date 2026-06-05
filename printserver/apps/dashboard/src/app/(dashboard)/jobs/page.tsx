'use client';

import { useEffect, useState } from 'react';
import { jobs as jobsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  FileText, RefreshCw, Search, Filter, Download,
  XCircle, RotateCcw, Clock, CheckCircle, Loader2,
  Pause, Play
} from 'lucide-react';
import { format } from 'date-fns';

// ── Status metadata ──────────────────────────────────────────────────────────

const statusIcons: Record<string, any> = {
  queued: Clock,
  processing: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: XCircle,
  held: Pause,
};

/** Inline-style dot + text badge colours (no Tailwind, no badge-* classes) */
const statusStyles: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  queued: {
    dot: '#f59e0b',
    bg: 'rgba(245,158,11,0.12)',
    text: '#f59e0b',
    border: 'rgba(245,158,11,0.35)',
  },
  processing: {
    dot: '#00d4ff',
    bg: 'rgba(0,212,255,0.12)',
    text: '#00d4ff',
    border: 'rgba(0,212,255,0.35)',
  },
  completed: {
    dot: '#00ff88',
    bg: 'rgba(0,255,136,0.12)',
    text: '#00ff88',
    border: 'rgba(0,255,136,0.35)',
  },
  failed: {
    dot: '#ff3d5a',
    bg: 'rgba(255,61,90,0.12)',
    text: '#ff3d5a',
    border: 'rgba(255,61,90,0.35)',
  },
  cancelled: {
    dot: '#ff3d5a',
    bg: 'rgba(255,61,90,0.08)',
    text: '#ff3d5a',
    border: 'rgba(255,61,90,0.25)',
  },
  held: {
    dot: '#f59e0b',
    bg: 'rgba(245,158,11,0.10)',
    text: '#f59e0b',
    border: 'rgba(245,158,11,0.30)',
  },
};

const defaultStyle = statusStyles.queued;

const LIMIT = 20;

// ── Helper: stat card accent configs ────────────────────────────────────────

const statAccents = {
  total:      { color: '#00d4ff', glow: 'rgba(0,212,255,0.3)',  bg: 'rgba(0,212,255,0.08)'  },
  queued:     { color: '#f59e0b', glow: 'rgba(245,158,11,0.3)', bg: 'rgba(245,158,11,0.08)' },
  processing: { color: '#00d4ff', glow: 'rgba(0,212,255,0.3)',  bg: 'rgba(0,212,255,0.08)'  },
  completed:  { color: '#00ff88', glow: 'rgba(0,255,136,0.3)',  bg: 'rgba(0,255,136,0.08)'  },
  failed:     { color: '#ff3d5a', glow: 'rgba(255,61,90,0.3)',  bg: 'rgba(255,61,90,0.08)'  },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  // Derived counts from current page data (best-effort without extra API call)
  const counts = jobs.reduce(
    (acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: LIMIT };
      if (status) params.status = status;
      if (search) params.search = search;

      const response = await jobsApi.list(params);
      setJobs(response.data.jobs);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [page, status]);

  // Socket real-time updates
  useEffect(() => {
    const handleJobUpdate = () => fetchJobs();
    on('job:new', handleJobUpdate);
    on('job:complete', handleJobUpdate);
    on('job:error', handleJobUpdate);
    on('job:held', handleJobUpdate);
    on('job:released', handleJobUpdate);

    return () => {
      off('job:new', handleJobUpdate);
      off('job:complete', handleJobUpdate);
      off('job:error', handleJobUpdate);
      off('job:held', handleJobUpdate);
      off('job:released', handleJobUpdate);
    };
  }, [page, status]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRetry = async (jobId: string) => {
    try {
      await jobsApi.retry(jobId);
      fetchJobs();
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      await jobsApi.cancel(jobId);
      fetchJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  const handleHold = async (jobId: string) => {
    try {
      await jobsApi.hold(jobId);
      fetchJobs();
    } catch (error) {
      console.error('Failed to hold job:', error);
    }
  };

  const handleRelease = async (jobId: string) => {
    try {
      await jobsApi.release(jobId);
      fetchJobs();
    } catch (error) {
      console.error('Failed to release job:', error);
    }
  };

  const handleExport = async () => {
    window.open(`${process.env.NEXT_PUBLIC_API_URL}/api/jobs/export/csv`, '_blank');
  };

  // ── Derived pagination ─────────────────────────────────────────────────────

  const totalPages = Math.ceil(total / LIMIT) || 1;
  const isFirstPage = page === 1;
  const isLastPage = page >= totalPages;
  const startItem = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const endItem = Math.min(page * LIMIT, total);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-cyan)',
          }}>
            <FileText size={20} />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '22px',
              color: 'var(--text-primary)',
              letterSpacing: '1px',
              margin: 0,
            }}>
              PRINT JOBS
            </h1>
            <p style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: '12px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              margin: 0,
            }}>
              Job Queue Monitor
            </p>
          </div>
        </div>

        <button
          onClick={handleExport}
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <Download size={16} />
          Export CSV
        </button>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: '16px',
      }}>
        {([
          { key: 'total',      label: 'Total Jobs',  value: total,                     Icon: FileText,     accent: statAccents.total      },
          { key: 'queued',     label: 'Queued',       value: counts.queued     ?? 0,    Icon: Clock,        accent: statAccents.queued      },
          { key: 'processing', label: 'Processing',   value: counts.processing ?? 0,    Icon: Loader2,      accent: statAccents.processing  },
          { key: 'completed',  label: 'Completed',    value: counts.completed  ?? 0,    Icon: CheckCircle,  accent: statAccents.completed   },
          { key: 'failed',     label: 'Failed',       value: counts.failed     ?? 0,    Icon: XCircle,      accent: statAccents.failed      },
        ] as const).map(({ key, label, value, Icon, accent }) => (
          <div key={key} className="stat-card" style={{ padding: '20px' }}>
            <div className="stat-card-header">
              <div style={{
                width: '36px', height: '36px', borderRadius: '8px',
                background: accent.bg,
                border: `1px solid ${accent.color}33`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: accent.color,
              }}>
                <Icon size={18} style={key === 'processing' && loading ? { animation: 'spin 1s linear infinite' } : undefined} />
              </div>
            </div>
            <div className="stat-value" style={{ fontSize: '32px', color: accent.color, textShadow: `0 0 20px ${accent.glow}` }}>
              {value}
            </div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      {/* ── Filter toolbar ───────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>

          {/* Search */}
          <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
            <Search
              size={16}
              style={{
                position: 'absolute', left: '12px', top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)', pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchJobs()}
              placeholder="Search jobs..."
              className="input"
              style={{ paddingLeft: '38px' }}
            />
          </div>

          {/* Status filter */}
          <div style={{ position: 'relative', minWidth: '160px' }}>
            <Filter
              size={14}
              style={{
                position: 'absolute', left: '12px', top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)', pointerEvents: 'none',
              }}
            />
            <select
              value={status}
              onChange={(e) => { setPage(1); setStatus(e.target.value); }}
              className="input"
              style={{ paddingLeft: '34px', appearance: 'none', cursor: 'pointer' }}
            >
              <option value="">All Status</option>
              <option value="queued">Queued</option>
              <option value="held">Held</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          {/* Refresh */}
          <button
            onClick={fetchJobs}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
            disabled={loading}
          >
            <RefreshCw
              size={15}
              style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined}
            />
            Refresh
          </button>

          {/* Result count badge */}
          {!loading && (
            <span style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginLeft: 'auto',
              whiteSpace: 'nowrap',
            }}>
              {total} result{total !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── Table card ───────────────────────────────────────────────────── */}
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>

        {/* Table title bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span className="section-title" style={{ margin: 0 }}>
            <FileText size={16} />
            Job Queue
          </span>
          {loading && (
            <span style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '11px',
              color: 'var(--accent-cyan)',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
              LOADING…
            </span>
          )}
        </div>

        {/* Scrollable table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{
                background: 'rgba(0,212,255,0.04)',
                borderBottom: '1px solid var(--border)',
              }}>
                {['Job ID', 'File Name', 'User', 'Printer', 'Pages', 'Status', 'Created', 'Actions'].map((h) => (
                  <th key={h} style={{
                    padding: '11px 16px',
                    textAlign: 'left',
                    fontFamily: "'Rajdhani', sans-serif",
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '1.5px',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && jobs.length === 0 ? (
                /* Skeleton rows */
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} style={{ padding: '14px 16px' }}>
                        <div className="skeleton-pulse" style={{ height: '14px', borderRadius: '4px', width: j === 1 ? '140px' : '70px' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state" style={{ margin: '16px', borderRadius: '8px' }}>
                      <FileText size={32} style={{ margin: '0 auto 8px', color: 'var(--text-muted)' }} />
                      No jobs found
                      {(status || search) && (
                        <div style={{ marginTop: '8px', fontSize: '11px' }}>
                          Try clearing your filters
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((job, idx) => {
                  const StatusIcon = statusIcons[job.status] || Clock;
                  const sty = statusStyles[job.status] || defaultStyle;
                  const isEven = idx % 2 === 0;

                  return (
                    <tr
                      key={job.id}
                      style={{
                        background: isEven ? 'transparent' : 'rgba(0,212,255,0.018)',
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = isEven ? 'transparent' : 'rgba(0,212,255,0.018)')}
                    >
                      {/* Job ID */}
                      <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          fontFamily: "'Share Tech Mono', monospace",
                          fontSize: '12px',
                          color: 'var(--accent-cyan)',
                          background: 'rgba(0,212,255,0.08)',
                          border: '1px solid rgba(0,212,255,0.2)',
                          borderRadius: '4px',
                          padding: '2px 7px',
                        }}>
                          {job.job_id?.slice(0, 8) ?? '—'}
                        </span>
                      </td>

                      {/* File name */}
                      <td style={{
                        padding: '13px 16px',
                        maxWidth: '200px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '14px',
                        color: 'var(--text-primary)',
                      }}>
                        {job.file_name || job.job_name || '—'}
                      </td>

                      {/* User */}
                      <td style={{ padding: '13px 16px', fontSize: '14px', color: 'var(--text-primary)' }}>
                        {job.username || 'Unknown'}
                      </td>

                      {/* Printer */}
                      <td style={{ padding: '13px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {job.printer_name || 'N/A'}
                      </td>

                      {/* Pages */}
                      <td style={{ padding: '13px 16px', fontFamily: "'Share Tech Mono', monospace", fontSize: '13px', color: 'var(--text-primary)', textAlign: 'center' }}>
                        {job.pages * job.copies}
                      </td>

                      {/* Status badge */}
                      <td style={{ padding: '13px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '4px 10px',
                          borderRadius: '20px',
                          background: sty.bg,
                          border: `1px solid ${sty.border}`,
                          fontSize: '12px',
                          fontFamily: "'Rajdhani', sans-serif",
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.8px',
                          color: sty.text,
                        }}>
                          {/* Animated dot */}
                          <span style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            background: sty.dot,
                            flexShrink: 0,
                            boxShadow: `0 0 6px ${sty.dot}`,
                            animation: job.status === 'processing' ? 'statusPulse 1.2s ease-in-out infinite' : undefined,
                          }} />
                          <StatusIcon
                            size={11}
                            style={job.status === 'processing' ? { animation: 'spin 1.2s linear infinite' } : undefined}
                          />
                          {job.status}
                        </span>
                      </td>

                      {/* Created at */}
                      <td style={{
                        padding: '13px 16px',
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}>
                        {format(new Date(job.created_at), 'MM/dd HH:mm')}
                      </td>

                      {/* Action buttons */}
                      <td style={{ padding: '13px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {/* Retry (failed only) */}
                          {job.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(job.job_id)}
                              title="Retry"
                              style={{
                                width: '30px', height: '30px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(0,212,255,0.08)',
                                border: '1px solid rgba(0,212,255,0.2)',
                                borderRadius: '6px',
                                color: '#00d4ff',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,212,255,0.2)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px rgba(0,212,255,0.4)';
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,212,255,0.08)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                              }}
                            >
                              <RotateCcw size={14} />
                            </button>
                          )}

                          {/* Hold (queued only) */}
                          {job.status === 'queued' && (
                            <button
                              onClick={() => handleHold(job.job_id)}
                              title="Hold"
                              style={{
                                width: '30px', height: '30px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(245,158,11,0.08)',
                                border: '1px solid rgba(245,158,11,0.2)',
                                borderRadius: '6px',
                                color: '#f59e0b',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.2)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px rgba(245,158,11,0.4)';
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(245,158,11,0.08)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                              }}
                            >
                              <Pause size={14} />
                            </button>
                          )}

                          {/* Release (held only) */}
                          {job.status === 'held' && (
                            <button
                              onClick={() => handleRelease(job.job_id)}
                              title="Release"
                              style={{
                                width: '30px', height: '30px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(0,255,136,0.08)',
                                border: '1px solid rgba(0,255,136,0.2)',
                                borderRadius: '6px',
                                color: '#00ff88',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,255,136,0.2)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px rgba(0,255,136,0.4)';
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,255,136,0.08)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                              }}
                            >
                              <Play size={14} />
                            </button>
                          )}

                          {/* Cancel (queued, processing, held) */}
                          {['queued', 'processing', 'held'].includes(job.status) && (
                            <button
                              onClick={() => handleCancel(job.job_id)}
                              title="Cancel"
                              style={{
                                width: '30px', height: '30px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(255,61,90,0.08)',
                                border: '1px solid rgba(255,61,90,0.2)',
                                borderRadius: '6px',
                                color: '#ff3d5a',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,61,90,0.2)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 0 8px rgba(255,61,90,0.4)';
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,61,90,0.08)';
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
                              }}
                            >
                              <XCircle size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination bar ─────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          flexWrap: 'wrap',
          gap: '12px',
        }}>
          {/* Item range info */}
          <p style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: '12px',
            color: 'var(--text-muted)',
            margin: 0,
          }}>
            {total === 0
              ? 'No jobs'
              : <>
                  Showing{' '}
                  <span style={{ color: 'var(--accent-cyan)' }}>{startItem}–{endItem}</span>
                  {' '}of{' '}
                  <span style={{ color: 'var(--text-primary)' }}>{total}</span>
                  {' '}jobs
                </>
            }
          </p>

          {/* Page controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={isFirstPage}
              className="btn-primary"
              style={{
                padding: '7px 16px',
                fontSize: '13px',
                opacity: isFirstPage ? 0.4 : 1,
                cursor: isFirstPage ? 'not-allowed' : 'pointer',
              }}
            >
              ← Prev
            </button>

            {/* Page number pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                // Sliding window of up to 5 page pills
                let p: number;
                if (totalPages <= 5) {
                  p = i + 1;
                } else if (page <= 3) {
                  p = i + 1;
                } else if (page >= totalPages - 2) {
                  p = totalPages - 4 + i;
                } else {
                  p = page - 2 + i;
                }
                const isActive = p === page;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    style={{
                      width: '32px', height: '32px',
                      borderRadius: '6px',
                      border: isActive ? '1px solid rgba(0,212,255,0.5)' : '1px solid var(--border)',
                      background: isActive ? 'rgba(0,212,255,0.15)' : 'transparent',
                      color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      fontFamily: "'Share Tech Mono', monospace",
                      fontSize: '13px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: isActive ? '0 0 10px rgba(0,212,255,0.25)' : 'none',
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setPage(page + 1)}
              disabled={isLastPage}
              className="btn-primary"
              style={{
                padding: '7px 16px',
                fontSize: '13px',
                opacity: isLastPage ? 0.4 : 1,
                cursor: isLastPage ? 'not-allowed' : 'pointer',
              }}
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
