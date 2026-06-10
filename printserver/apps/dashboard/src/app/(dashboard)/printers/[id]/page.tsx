'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { printers as printersApi, paper as paperApi, drivers as driversApi } from '@/lib/api';
import { on, off, getSocket } from '@/hooks/useSocket';
import {
  ArrowLeft, Printer, XCircle, FileText, Clock,
  CheckCircle2, Loader2, RefreshCw, Activity, Server, Hash, HardDrive, Link2,
  ChevronDown, Search, Play, Trash2
} from 'lucide-react';
import { format } from 'date-fns';

export default function PrinterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params?.id);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Driver dropdown state
  const [driverDropdown, setDriverDropdown] = useState(false);
  const [driverSearch, setDriverSearch] = useState('');
  const [driversList, setDriversList] = useState<any[]>([]);
  const [assigningDriver, setAssigningDriver] = useState(false);

  // Paper state
  const [paperConfig, setPaperConfig] = useState<any>(null);
  const [paperSizes, setPaperSizes] = useState<any[]>([]);
  const [paperDropdown, setPaperDropdown] = useState(false);
  const [paperSearch, setPaperSearch] = useState('');
  const [savingPaper, setSavingPaper] = useState(false);

  // Quick action state
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const fetchDetail = useCallback(async () => {
    try {
      const res = await printersApi.get(id);
      setData(res.data);
      setNotFound(false);
    } catch (e: any) {
      if (e?.response?.status === 404) setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Fetch drivers, paper sizes, and paper config for printer
  const fetchMetadata = useCallback(async () => {
    try {
      const [driversRes, paperRes, printerPaperRes] = await Promise.all([
        driversApi.list().catch(() => ({ data: [] })),
        paperApi.list().catch(() => ({ data: { sizes: [] } })),
        paperApi.getForPrinter(id).catch(() => ({ data: null })),
      ]);
      setDriversList(driversRes.data || []);
      setPaperSizes(Array.isArray(paperRes.data?.sizes) ? paperRes.data.sizes : []);
      setPaperConfig(printerPaperRes.data || null);
    } catch {
      /* silent */
    }
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) { setNotFound(true); setLoading(false); return; }
    fetchDetail();
    fetchMetadata();

    // Socket: live updates on printer:patch with matching id
    const handlePrinterPatch = (d: any) => {
      if (!d?.id || d.id !== id) return;
      setData((prev: any) => prev ? { ...prev, ...d } : prev);
    };
    on('printer:patch', handlePrinterPatch);

    // WS-fallback polling (15s) — only when socket is disconnected.
    const wsFallback = (getSocket() as any);
    let refresh: any = null;
    const onDisconnect = () => { refresh = setInterval(fetchDetail, 15000); };
    const onConnect = () => { if (refresh) { clearInterval(refresh); refresh = null; } };
    if (wsFallback && !wsFallback.connected) onDisconnect();
    wsFallback?.on?.('disconnect', onDisconnect);
    wsFallback?.on?.('connect', onConnect);

    return () => {
      off('printer:patch', handlePrinterPatch);
      if (refresh) clearInterval(refresh);
      wsFallback?.off?.('disconnect', onDisconnect);
      wsFallback?.off?.('connect', onConnect);
    };
  }, [id, fetchDetail, fetchMetadata]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!driverDropdown) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-driver-dropdown]')) return;
      setDriverDropdown(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [driverDropdown]);

  useEffect(() => {
    if (!paperDropdown) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-paper-dropdown]')) return;
      setPaperDropdown(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [paperDropdown]);

  const C = {
    cyan: 'var(--accent-cyan)', green: 'var(--accent-green)', amber: 'var(--accent-amber)',
    red: '#ff3d5a', muted: 'var(--text-muted)', text: 'var(--text-primary)',
    border: 'var(--border)', card: 'var(--bg-card)', sec: 'var(--bg-secondary)',
    mono: "'Share Tech Mono', monospace", sans: "'Rajdhani', sans-serif",
  };

  const statusColor = (s = '') => {
    const x = s.toLowerCase();
    if (x === 'completed') return C.green;
    if (x === 'failed' || x === 'cancelled') return C.red;
    if (x === 'printing') return C.cyan;
    return C.amber;
  };

  const healthStatusColor = (s = '') => {
    const x = s.toLowerCase();
    if (x === 'online') return C.green;
    if (x === 'offline') return C.muted;
    if (x === 'error') return C.red;
    return C.amber;
  };

  // ---- Driver assignment handler ----
  const handleAssignDriver = async (driverId: number | null) => {
    setAssigningDriver(true);
    try {
      await driversApi.assignToPrinter(id, driverId);
      await fetchDetail();
      await fetchMetadata();
    } catch (e: any) {
      alert(`Failed to assign driver: ${e.response?.data?.error || e.message}`);
    } finally {
      setAssigningDriver(false);
      setDriverDropdown(false);
    }
  };

  // ---- Paper size handler ----
  const handlePaperChange = async (sizeName: string) => {
    setSavingPaper(true);
    try {
      const matched = paperSizes.find((s: any) => s.name === sizeName);
      const payload: any = { size: sizeName, orientation: 'portrait', tray: 'auto' };
      if (matched && !matched.builtin) {
        payload.customWidthMm = matched.widthMm;
        payload.customHeightMm = matched.heightMm;
      }
      await paperApi.setForPrinter(id, payload);
      const res = await paperApi.getForPrinter(id).catch(() => ({ data: null }));
      setPaperConfig(res.data || null);
      await fetchDetail();
    } catch (e) {
      console.error('Failed to update paper', e);
    } finally {
      setSavingPaper(false);
      setPaperDropdown(false);
    }
  };

  const handleClearPaper = async () => {
    setSavingPaper(true);
    try {
      await paperApi.clearForPrinter(id);
      const res = await paperApi.getForPrinter(id).catch(() => ({ data: null }));
      setPaperConfig(res.data || null);
      await fetchDetail();
    } catch (e) {
      console.error('Failed to clear paper', e);
    } finally {
      setSavingPaper(false);
      setPaperDropdown(false);
    }
  };

  // ---- Quick action handlers ----
  const handleTestPrint = async () => {
    setActionLoading(prev => ({ ...prev, testPrint: true }));
    try {
      const resp = await printersApi.testPrint(id);
      const d = resp.data || {};
      const ms = typeof d.durationMs === 'number' ? ` in ${d.durationMs} ms` : '';
      alert(
        `✅ Test print OK${ms}\n\n` +
        `Printer: ${d.printerName ?? id}\n` +
        `Job #${d.jobId ?? '-'}${d.method ? ` (via ${d.method})` : ''}\n\n` +
        `One test page should now be printing.`
      );
    } catch (e: any) {
      const d = e.response?.data || {};
      alert(
        `❌ Test print FAILED\n\n${d.error || e.message}\n\n` +
        `Check that the node is online and the printer driver is installed.`
      );
    } finally {
      setActionLoading(prev => ({ ...prev, testPrint: false }));
    }
  };

  const handleClearQueue = async () => {
    if (!confirm('Are you sure you want to cancel all active jobs in the queue for this printer?')) return;
    setActionLoading(prev => ({ ...prev, clearQueue: true }));
    try {
      const response = await printersApi.clearQueue(id);
      alert(`Successfully cleared queue! ${response.data.cancelledCount} jobs cancelled.`);
      fetchDetail();
    } catch (e: any) {
      alert(`Failed to clear queue: ${e.response?.data?.error || e.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, clearQueue: false }));
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Loader2 className="spin" size={28} style={{ color: C.cyan, animation: 'spin 1s linear infinite' }} />
        <div style={{ color: C.muted, fontFamily: C.sans }}>Loading printer details...</div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div style={{ minHeight: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <XCircle size={40} style={{ color: C.red }} />
        <h2 style={{ fontFamily: C.mono, color: C.text, margin: 0 }}>PRINTER NOT FOUND</h2>
        <Link href="/printers" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', textDecoration: 'none' }}>
          <button className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <ArrowLeft size={16} /> Back to Printers
          </button>
        </Link>
      </div>
    );
  }

  const online = data.status === 'online';
  const jobs: any[] = data.recentJobs || [];
  const health: any[] = data.health || [];

  // Compute job stats from recentJobs
  const totalJobs = jobs.length;
  const completedJobs = jobs.filter((j: any) => j.status === 'completed').length;
  const failedJobs = jobs.filter((j: any) => j.status === 'failed' || j.status === 'cancelled').length;
  const pagesPrinted = jobs.reduce((sum: number, j: any) => sum + (j.pages || 0), 0);

  // Current paper effective name
  const effectivePaperName = paperConfig?.effective?.size || paperConfig?.override?.size || data.config?.paper_size || 'Default';

  const infoRows = [
    { k: 'Type', v: data.type || 'N/A', icon: <Server size={14} />, color: C.text },
    { k: 'Group', v: data.group_name || 'N/A', icon: <Hash size={14} />, color: C.text },
    { k: 'Port', v: data.port || 'N/A', icon: <Hash size={14} />, color: C.text },
    { k: 'Host Node', v: data.client_hostname || data.client_id || 'N/A', icon: <Server size={14} />, color: C.cyan, link: data.client_id ? `/clients/${data.client_id}` : null },
    { k: 'Share Name', v: data.share_name || (data.is_shared ? 'Shared' : '—'), icon: <Link2 size={14} />, color: C.text },
    { k: 'Default Printer', v: data.is_default ? 'Yes' : 'No', icon: <Printer size={14} />, color: data.is_default ? C.green : C.muted },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/printers" style={{ background: C.sec, border: `1px solid ${C.border}`, borderRadius: 8, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, cursor: 'pointer', textDecoration: 'none' }}>
            <ArrowLeft size={18} />
          </Link>
          <div style={{ width: 46, height: 46, borderRadius: 10, background: online ? 'rgba(0,255,136,0.1)' : C.sec, border: `1px solid ${online ? 'rgba(0,255,136,0.3)' : C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: online ? C.green : C.muted, boxShadow: online ? '0 0 16px rgba(0,255,136,0.25)' : 'none' }}>
            <Printer size={22} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontFamily: C.mono, fontSize: 22, color: C.text, letterSpacing: 1 }}>{data.name}</h1>
            <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
              {data.type || 'printer'} · Printer #{data.id}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: C.mono, fontSize: 11, padding: '4px 8px', borderRadius: 6, background: C.sec, color: C.muted, border: `1px solid ${C.border}`, textTransform: 'uppercase' }}>
            {data.type || 'N/A'}
          </span>
          <span style={{ fontFamily: C.mono, fontSize: 11, padding: '4px 12px', borderRadius: 6, background: online ? 'rgba(0,255,136,0.12)' : C.sec, color: online ? C.green : C.muted, border: `1px solid ${online ? 'rgba(0,255,136,0.3)' : C.border}` }}>
            {online ? '● ONLINE' : '○ OFFLINE'}
          </span>
          <button onClick={() => { fetchDetail(); fetchMetadata(); }} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      {/* Two-column: Printer Info + Job Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* Printer Info */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Printer size={16} style={{ color: C.amber }} /> Printer Info
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

            {/* ---- Driver row (editable) ---- */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <span style={{ color: C.muted }}><HardDrive size={14} /></span>Driver
              </span>
              <div style={{ position: 'relative' }} data-driver-dropdown>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !driverDropdown;
                    setDriverDropdown(next);
                    if (next) setDriverSearch('');
                  }}
                  disabled={assigningDriver}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    fontSize: '13px', fontWeight: 600,
                    color: data.driver_id ? C.text : C.muted,
                    background: 'rgba(0,0,0,0.3)',
                    border: `1px solid ${C.border}`,
                    borderRadius: '6px', padding: '4px 8px',
                    fontFamily: C.mono,
                    cursor: 'pointer',
                    maxWidth: '180px', textAlign: 'right',
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.cyan; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; }}
                >
                  {assigningDriver ? (
                    <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                  ) : (
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {data.driver_name || data.driver || 'N/A'}
                    </span>
                  )}
                  <ChevronDown size={10} style={{ opacity: 0.6 }} />
                </button>
                {driverDropdown && (
                  <div
                    className="card"
                    style={{
                      position: 'absolute', right: 0, top: '32px', zIndex: 100,
                      width: '280px', maxHeight: '340px', overflowY: 'auto',
                      padding: '8px 0', display: 'flex', flexDirection: 'column'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
                      <div style={{ position: 'relative' }}>
                        <Search style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', width: '13px', height: '13px', color: C.muted }} />
                        <input
                          autoFocus
                          type="text"
                          placeholder="Search driver…"
                          value={driverSearch}
                          onChange={(e) => setDriverSearch(e.target.value)}
                          style={{
                            width: '100%', padding: '6px 8px 6px 28px', fontSize: '12px',
                            background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`,
                            borderRadius: '6px', color: C.text, outline: 'none',
                          }}
                          onKeyDown={(e) => { if (e.key === 'Escape') { setDriverDropdown(false); setDriverSearch(''); } }}
                        />
                      </div>
                      {data.driver_id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAssignDriver(null); }}
                          style={{
                            background: 'transparent', border: 'none', color: C.amber,
                            fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '6px 0 0',
                            display: 'flex', alignItems: 'center', gap: '4px'
                          }}
                        >
                          <RefreshCw style={{ width: '10px', height: '10px' }} /> Clear driver
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {(() => {
                        const q = driverSearch.toLowerCase().trim();
                        const filtered = q
                          ? driversList.filter((d: any) => d.name.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q))
                          : driversList;
                        return filtered.length > 0 ? filtered.map((d: any) => (
                          <button
                            key={d.id}
                            onClick={(e) => { e.stopPropagation(); handleAssignDriver(d.id); }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: '13px',
                              background: data.driver_id === d.id ? 'rgba(0, 212, 255, 0.08)' : 'transparent',
                              border: 'none',
                              color: data.driver_id === d.id ? C.cyan : C.text,
                              cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '2px',
                              transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = data.driver_id === d.id ? 'rgba(0, 212, 255, 0.08)' : 'transparent'; }}
                          >
                            <span style={{ fontWeight: data.driver_id === d.id ? 600 : 400 }}>
                              {d.name}
                            </span>
                            {d.description && (
                              <span style={{ fontSize: '11px', color: C.muted }}>
                                {d.description}
                              </span>
                            )}
                          </button>
                        )) : (
                          <div style={{ padding: '16px 12px', fontSize: '12px', color: C.muted, textAlign: 'center' }}>
                            No match for "{driverSearch}"
                          </div>
                        );
                      })()}
                      {driversList.length === 0 && (
                        <div style={{ padding: '16px 12px', fontSize: '12px', color: C.muted, textAlign: 'center' }}>
                          No drivers. Add in Settings → Drivers.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ---- Paper Size row (editable) ---- */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                <span style={{ color: C.muted }}><FileText size={14} /></span>Paper Size
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} data-paper-dropdown>
                <span style={{ fontFamily: C.mono, fontSize: 13, color: C.text }}>
                  {savingPaper ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: C.cyan }} /> : effectivePaperName}
                  {paperConfig?.override && <span style={{ fontSize: 10, color: C.amber, marginLeft: 4 }}>override</span>}
                </span>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const next = !paperDropdown;
                      setPaperDropdown(next);
                      if (next) setPaperSearch('');
                    }}
                    disabled={savingPaper}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 22, height: 22, borderRadius: 4,
                      background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`,
                      color: C.muted, cursor: 'pointer', transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.cyan; e.currentTarget.style.color = C.cyan; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
                    title="Change paper size"
                  >
                    <ChevronDown size={12} />
                  </button>
                  {paperDropdown && (
                    <div
                      className="card"
                      style={{
                        position: 'absolute', right: 0, top: '30px', zIndex: 100,
                        width: '260px', maxHeight: '340px', overflowY: 'auto',
                        padding: '8px 0', display: 'flex', flexDirection: 'column'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${C.border}` }}>
                        <div style={{ position: 'relative' }}>
                          <Search style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', width: '13px', height: '13px', color: C.muted }} />
                          <input
                            autoFocus
                            type="text"
                            placeholder="Search paper sizes…"
                            value={paperSearch}
                            onChange={(e) => setPaperSearch(e.target.value)}
                            style={{
                              width: '100%', padding: '6px 8px 6px 28px', fontSize: '12px',
                              background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}`,
                              borderRadius: '6px', color: C.text, outline: 'none',
                            }}
                            onKeyDown={(e) => { if (e.key === 'Escape') { setPaperDropdown(false); setPaperSearch(''); } }}
                          />
                        </div>
                        {paperConfig?.override && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleClearPaper(); }}
                            style={{
                              background: 'transparent', border: 'none', color: C.amber,
                              fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: '6px 0 0',
                              display: 'flex', alignItems: 'center', gap: '4px'
                            }}
                          >
                            <RefreshCw style={{ width: '10px', height: '10px' }} /> Reset to default
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {(() => {
                          const q = paperSearch.toLowerCase().trim();
                          const filtered = q
                            ? paperSizes.filter((s: any) => s.name.toLowerCase().includes(q))
                            : paperSizes;
                          return filtered.length > 0 ? filtered.map((s: any) => (
                            <button
                              key={s.name}
                              onClick={(e) => { e.stopPropagation(); handlePaperChange(s.name); }}
                              style={{
                                width: '100%', textAlign: 'left', padding: '8px 12px', fontSize: '13px',
                                background: effectivePaperName === s.name ? 'rgba(0, 212, 255, 0.08)' : 'transparent',
                                border: 'none',
                                color: effectivePaperName === s.name ? C.cyan : C.text,
                                cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = effectivePaperName === s.name ? 'rgba(0, 212, 255, 0.08)' : 'transparent'; }}
                            >
                              <span style={{ fontWeight: effectivePaperName === s.name ? 600 : 400 }}>
                                {s.name}
                              </span>
                              <span style={{ fontSize: '10px', color: C.muted }}>
                                {s.widthMm}×{s.heightMm}mm
                              </span>
                            </button>
                          )) : (
                            <div style={{ padding: '16px 12px', fontSize: '12px', color: C.muted, textAlign: 'center' }}>
                              No match for "{paperSearch}"
                            </div>
                          );
                        })()}
                        {paperSizes.length === 0 && (
                          <div style={{ padding: '16px 12px', fontSize: '12px', color: C.muted, textAlign: 'center' }}>
                            No paper sizes available.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {paperConfig?.override && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleClearPaper(); }}
                    disabled={savingPaper}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 22, height: 22, borderRadius: 4,
                      background: 'rgba(255,61,90,0.15)', border: `1px solid rgba(255,61,90,0.3)`,
                      color: C.red, cursor: 'pointer', transition: 'all 0.2s',
                      fontSize: '10px'
                    }}
                    title="Reset to default paper size"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* ---- Static info rows ---- */}
            {infoRows.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < infoRows.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13, fontFamily: C.sans }}>
                  <span style={{ color: C.muted }}>{r.icon}</span>{r.k}
                </span>
                <span style={{ fontFamily: C.mono, fontSize: 13, color: r.color }}>
                  {r.link ? (
                    <Link href={r.link} style={{ color: C.cyan, textDecoration: 'none' }}>{r.v}</Link>
                  ) : r.v}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Job Stats + Health */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} style={{ color: C.cyan }} /> Job Stats
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Jobs', value: totalJobs, color: C.cyan },
              { label: 'Completed', value: completedJobs, color: C.green },
              { label: 'Failed', value: failedJobs, color: C.red },
              { label: 'Pages Printed', value: pagesPrinted, color: C.amber },
            ].map((s, i) => (
              <div key={i} style={{ padding: 14, borderRadius: 8, background: C.sec, border: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: C.mono, fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontFamily: C.sans, fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Health timeline */}
          <h3 style={{ margin: '0 0 12px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} style={{ color: C.green }} /> Health Status
          </h3>
          {health.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: C.muted, fontFamily: C.sans, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
              No health data available.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {health.slice(0, 5).map((h: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < Math.min(health.length, 5) - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: healthStatusColor(h.status), boxShadow: h.status === 'online' ? `0 0 8px ${C.green}` : 'none', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontFamily: C.sans, fontSize: 12, color: C.text, textTransform: 'uppercase' }}>{h.status || 'unknown'}</span>
                  <span style={{ fontFamily: C.mono, fontSize: 11, color: C.muted }}>
                    {h.recorded_at ? format(new Date(h.recorded_at), 'dd MMM HH:mm') : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Play size={16} style={{ color: C.cyan }} /> Quick Actions
        </h3>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={handleTestPrint}
            disabled={actionLoading.testPrint}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 8,
              background: 'rgba(0, 212, 255, 0.12)', border: `1px solid rgba(0, 212, 255, 0.3)`,
              color: C.cyan, cursor: actionLoading.testPrint ? 'wait' : 'pointer',
              fontFamily: C.sans, fontSize: 13, fontWeight: 600,
              transition: 'all 0.2s', opacity: actionLoading.testPrint ? 0.6 : 1,
            }}
            onMouseEnter={(e) => { if (!actionLoading.testPrint) { e.currentTarget.style.background = 'rgba(0, 212, 255, 0.2)'; e.currentTarget.style.borderColor = C.cyan; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0, 212, 255, 0.12)'; e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.3)'; }}
          >
            {actionLoading.testPrint ? (
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Play size={15} />
            )}
            Test Print
          </button>
          <button
            onClick={handleClearQueue}
            disabled={actionLoading.clearQueue}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 8,
              background: 'rgba(255, 61, 90, 0.12)', border: `1px solid rgba(255, 61, 90, 0.3)`,
              color: C.red, cursor: actionLoading.clearQueue ? 'wait' : 'pointer',
              fontFamily: C.sans, fontSize: 13, fontWeight: 600,
              transition: 'all 0.2s', opacity: actionLoading.clearQueue ? 0.6 : 1,
            }}
            onMouseEnter={(e) => { if (!actionLoading.clearQueue) { e.currentTarget.style.background = 'rgba(255, 61, 90, 0.2)'; e.currentTarget.style.borderColor = C.red; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255, 61, 90, 0.12)'; e.currentTarget.style.borderColor = 'rgba(255, 61, 90, 0.3)'; }}
          >
            {actionLoading.clearQueue ? (
              <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <Trash2 size={15} />
            )}
            Clear Queue
          </button>
        </div>
      </div>

      {/* Recent Jobs */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontFamily: C.sans, fontSize: 14, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={16} style={{ color: C.green }} /> Recent Jobs
        </h3>
        {jobs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontFamily: C.sans, fontSize: 13, border: `1px dashed ${C.border}`, borderRadius: 8 }}>
            No recent print jobs for this printer.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {jobs.map((j: any, i: number) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: C.sec, borderRadius: 8, border: `1px solid ${C.border}` }}>
                <FileText size={15} style={{ color: C.muted, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: C.sans, fontSize: 13, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {j.file_name || j.job_name || 'Untitled'}
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
