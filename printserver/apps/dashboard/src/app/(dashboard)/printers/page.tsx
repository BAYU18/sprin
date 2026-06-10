'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { printers as printersApi, paper as paperApi, drivers as driversApi } from '@/lib/api';
import api from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  Printer, Plus, RefreshCw, CheckCircle, XCircle,
  AlertTriangle, MoreVertical, Trash2, Edit, FileText, Eye, EyeOff, ChevronDown,
  Play, Ban, Filter, Tag, Folder, Search, X, Monitor, Sparkles, Download
} from 'lucide-react';
import Link from 'next/link';
import AddPrinterModal from '@/components/AddPrinterModal';
import PrinterPaperConfig from '@/components/PrinterPaperConfig';

interface PaperSize {
  name: string;
  widthMm: number;
  heightMm: number;
  builtin: boolean;
}

interface PrinterGroup {
  id: number;
  name: string;
  description?: string;
  settings?: any;
  printer_count?: string;
}

export default function PrintersPage() {
  const [printers, setPrinters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  // Smart driver auto-detect
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectResult, setAutoDetectResult] = useState<any | null>(null);
  // Per-printer paper config modal (full: size + orientation + tray + custom)
  const [paperConfigPrinter, setPaperConfigPrinter] = useState<{ id: number; name: string } | null>(null);
  const [paperSizes, setPaperSizes] = useState<PaperSize[]>([]);
  const [paperDefault, setPaperDefault] = useState('A4');
  // Track which printer card has the paper dropdown open
  const [paperDropdown, setPaperDropdown] = useState<number | null>(null);
  // Track saving state per printer
  const [savingPaper, setSavingPaper] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  // TIER-1 #3: Group & tag filter state
  const [groups, setGroups] = useState<PrinterGroup[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [filterGroup, setFilterGroup] = useState<string>('');  // '' = all
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [showGroupModal, setShowGroupModal] = useState(false);

  const handleTestPrint = async (printerId: number) => {
    setActionLoading(prev => ({ ...prev, [`test-${printerId}`]: true }));
    try {
      const resp = await printersApi.testPrint(printerId);
      const d = resp.data || {};
      const ms = typeof d.durationMs === 'number' ? ` in ${d.durationMs} ms` : '';
      alert(
        `✅ Test print OK${ms}\n\n` +
        `Printer: ${d.printerName ?? printerId}\n` +
        `Node ID: ${d.clientId ?? '-'}\n` +
        `Job #${d.jobId ?? '-'}${d.method ? ` (via ${d.method})` : ''}\n\n` +
        `One test page should now be printing.`
      );
    } catch (e: any) {
      const d = e.response?.data || {};
      const ms = typeof d.durationMs === 'number' ? ` after ${d.durationMs} ms` : '';
      alert(
        `❌ Test print FAILED${ms}\n\n` +
        `${d.error || e.message}\n\n` +
        (d.clientId ? `Node ID: ${d.clientId}\n` : '') +
        `Check that the node is online and the printer driver is installed.`
      );
    } finally {
      setActionLoading(prev => ({ ...prev, [`test-${printerId}`]: false }));
    }
  };

  const handleClearQueue = async (printerId: number) => {
    if (!confirm('Are you sure you want to cancel all active jobs in the queue for this printer?')) return;
    setActionLoading(prev => ({ ...prev, [`clear-${printerId}`]: true }));
    try {
      const response = await printersApi.clearQueue(printerId);
      alert(`Successfully cleared queue! ${response.data.cancelledCount} jobs cancelled.`);
      fetchPrinters();
    } catch (e: any) {
      alert(`Failed to clear queue: ${e.response?.data?.error || e.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [`clear-${printerId}`]: false }));
    }
  };

  // TIER-2 #4: in-flight de-dup so concurrent triggers don't stack requests
  const fetchInFlight = useRef(false);
  const fetchPrinters = useCallback(async () => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      // Server-side filters only (group/tag/showHidden). Name search is
      // client-side and must NOT be a dependency here, otherwise every
      // keystroke fires a full /api/printers request → rate-limit storm.
      const params: any = {};
      if (showHidden) params.include_removed = '1';
      if (filterGroup) params.group = filterGroup;
      if (filterTag) params.tag = filterTag;
      const resp = await printersApi.list(params);
      const list = Array.isArray(resp.data) ? resp.data : [];
      setPrinters(list);
    } catch (error) {
      console.error('Failed to fetch printers:', error);
    } finally {
      fetchInFlight.current = false;
      setLoading(false);
    }
  }, [showHidden, filterGroup, filterTag]);

  const fetchGroupsAndTags = useCallback(async () => {
    try {
      const [g, t] = await Promise.all([
        api.get('/api/printer-groups').then(r => r.data).catch(() => []),
        api.get('/api/printer-groups/tags/all').then(r => r.data).catch(() => [])
      ]);
      if (Array.isArray(g)) setGroups(g);
      if (Array.isArray(t)) setAvailableTags(t);
    } catch (e) {
      console.error('Failed to fetch groups/tags', e);
    }
  }, []);

  const fetchHiddenCount = async () => {
    try {
      const resp = await printersApi.removed();
      if (resp?.data) {
        setHiddenCount(resp.data.count || 0);
      }
    } catch (e) { /* silent */ }
  };

  // Smart driver auto-detect: previews matches (dry-run), then applies if any
  // changes are found. Re-evaluates all printers (including already-assigned).
  const handleAutoDetect = async () => {
    setAutoDetecting(true);
    setAutoDetectResult(null);
    try {
      // 1) Dry-run to compute matches without writing.
      const preview = await driversApi.autoAssign({ dry_run: true, reassign: true });
      const toChange = (preview.data?.results || []).filter((r: any) => r.matched && r.changed);

      if (toChange.length === 0) {
        const matched = preview.data?.matched || 0;
        setAutoDetectResult({
          ok: true,
          applied: 0,
          message: matched > 0
            ? `All ${matched} matched printer(s) already have the correct driver.`
            : 'No confident driver matches found for unassigned printers.',
        });
        return;
      }

      // 2) Apply for real.
      const applied = await driversApi.autoAssign({ dry_run: false, reassign: true });
      setAutoDetectResult({
        ok: true,
        applied: applied.data?.assigned || 0,
        unmatched: applied.data?.unmatched || 0,
        details: toChange,
        message: `Auto-assigned ${applied.data?.assigned || 0} driver(s).`,
      });
      await fetchPrinters();
    } catch (e: any) {
      setAutoDetectResult({
        ok: false,
        message: e?.response?.data?.error || 'Auto-detect failed. Check server logs.',
      });
    } finally {
      setAutoDetecting(false);
    }
  };

  const fetchPaperSizes = async () => {
    try {
      const resp = await paperApi.list();
      setPaperSizes(resp.data.sizes || []);
      setPaperDefault(resp.data.default || 'A4');
    } catch (e) { /* silent */ }
  };

  // TIER-2 #4: in-place patch from granular events (no full re-fetch).
  // Mirror clients/page.tsx:31-45 pattern. Fallback to re-fetch only when
  // event has no id (shouldn't happen with new backend, but defensive).
  const handlePrinterPatch = useCallback((data: any) => {
    if (!data?.id) {
      fetchPrinters();
      return;
    }
    setPrinters(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p));
  }, []);

  const handlePrinterCreated = useCallback((data: any) => {
    if (!data?.id) {
      fetchPrinters();
      return;
    }
    setPrinters(prev => {
      const exists = prev.some(p => p.id === data.id);
      if (exists) return prev.map(p => p.id === data.id ? { ...p, ...data } : p);
      return [...prev, data];
    });
    fetchHiddenCount();
  }, [fetchHiddenCount]);

  const handlePrinterRemoved = useCallback((data: any) => {
    if (!data?.id) {
      fetchPrinters();
      return;
    }
    setPrinters(prev => prev.filter(p => p.id !== data.id));
    fetchHiddenCount();
  }, [fetchHiddenCount]);

  const handleGroupUpdate = useCallback(() => {
    fetchGroupsAndTags();
    fetchPrinters();
  }, [fetchGroupsAndTags, fetchPrinters]);

  useEffect(() => {
    fetchPrinters();
    fetchHiddenCount();
    fetchPaperSizes();
    fetchGroupsAndTags();

    // TIER-2 #4: switch from 'printer:update' (full-list re-fetch trigger)
    // to granular events ('printer:patch'/'printer:created'/'printer:removed')
    // so the dashboard doesn't fire /api/printers on every heartbeat.
    on('printer:patch', handlePrinterPatch);
    on('printer:created', handlePrinterCreated);
    on('printer:removed', handlePrinterRemoved);
    on('printer-group:created', handleGroupUpdate);
    on('printer-group:updated', handleGroupUpdate);
    on('printer-group:deleted', handleGroupUpdate);
    return () => {
      off('printer:patch', handlePrinterPatch);
      off('printer:created', handlePrinterCreated);
      off('printer:removed', handlePrinterRemoved);
      off('printer-group:created', handleGroupUpdate);
      off('printer-group:updated', handleGroupUpdate);
      off('printer-group:deleted', handleGroupUpdate);
    };
  }, [fetchPrinters, fetchGroupsAndTags, handlePrinterPatch, handlePrinterCreated, handlePrinterRemoved, handleGroupUpdate]);

  // When showHidden toggles, re-fetch
  useEffect(() => {
    fetchPrinters();
  }, [showHidden, fetchPrinters]);

  const handlePaperChange = async (printerId: number, sizeName: string) => {
    setSavingPaper(printerId);
    try {
      const matched = paperSizes.find(s => s.name === sizeName);
      const payload: any = { size: sizeName, orientation: 'portrait', tray: 'auto' };
      if (matched && !matched.builtin) {
        payload.customWidthMm = matched.widthMm;
        payload.customHeightMm = matched.heightMm;
      }
      await paperApi.setForPrinter(printerId, payload);
      await fetchPrinters();
    } catch (e) {
      console.error('Failed to update paper', e);
    } finally {
      setSavingPaper(null);
      setPaperDropdown(null);
    }
  };

  const handleResetPaper = async (printerId: number) => {
    setSavingPaper(printerId);
    try {
      await paperApi.clearForPrinter(printerId);
      await fetchPrinters();
    } catch (e) {
      console.error('Failed to reset paper', e);
    } finally {
      setSavingPaper(null);
      setPaperDropdown(null);
    }
  };

  // Close paper dropdown on click outside
  useEffect(() => {
    if (paperDropdown === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If click is inside a paper dropdown, don't close
      if (target.closest('[data-paper-dropdown]')) return;
      setPaperDropdown(null);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [paperDropdown]);

  // Computed values for stats
  const activePrintersList = printers.filter(p => p.config?.auto_removed !== 'true');
  const totalPrintersCount = activePrintersList.length;
  const onlinePrintersCount = printers.filter(p => p.status === 'online').length;
  const offlinePrintersCount = activePrintersList.filter(p => p.status === 'offline').length;
  const hiddenPrintersCount = hiddenCount;

  // Client-side name search (no API call). Applied at render-time so typing in
  // the search box never triggers a network request.
  const displayPrinters = filterSearch.trim()
    ? printers.filter((p: any) => {
        const q = filterSearch.toLowerCase();
        return (
          (p.name || '').toLowerCase().includes(q) ||
          (p.slug || '').toLowerCase().includes(q) ||
          (p.group_name || '').toLowerCase().includes(q)
        );
      })
    : printers;

  // Helper for status styles
  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'online':
        return {
          color: 'var(--accent-green)',
          glow: 'var(--glow-green)',
        };
      case 'busy':
        return {
          color: 'var(--accent-amber)',
          glow: 'var(--glow-amber)',
        };
      case 'offline':
        return {
          color: 'var(--accent-red)',
          glow: 'var(--glow-red)',
        };
      default:
        return {
          color: 'var(--text-muted)',
          glow: 'none',
        };
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '350px', gap: '16px' }}>
        <div className="loading-spinner" />
        <span style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, fontSize: '14px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px' }}>
          Initializing printer node connections...
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Printer style={{ width: '28px', height: '28px', color: 'var(--accent-cyan)' }} />
            Printers Dashboard
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Monitor node status, queue configurations, and print metrics.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => setShowHidden(!showHidden)}
            className="btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: showHidden ? 'rgba(0, 212, 255, 0.1)' : 'transparent',
              color: showHidden ? 'var(--accent-cyan)' : 'var(--text-primary)',
              cursor: 'pointer',
              transition: 'all 0.2s',
              borderColor: showHidden ? 'var(--accent-cyan)' : 'var(--border)'
            }}
            title={showHidden ? 'Showing all (including auto-removed)' : 'Hidden printers auto-filtered'}
          >
            {showHidden ? <Eye style={{ width: '16px', height: '16px' }} /> : <EyeOff style={{ width: '16px', height: '16px' }} />}
            <span>{showHidden ? 'Show All' : 'Hidden'}</span>
            {hiddenCount > 0 && !showHidden && (
              <span style={{
                marginLeft: '6px',
                padding: '2px 6px',
                fontSize: '10px',
                fontWeight: 'bold',
                fontFamily: 'Share Tech Mono, monospace',
                background: 'var(--accent-cyan)',
                color: 'var(--bg-primary)',
                borderRadius: '10px'
              }}>
                {hiddenCount}
              </span>
            )}
          </button>
          
          <button
            onClick={() => { fetchPrinters(); fetchHiddenCount(); }}
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            <RefreshCw style={{ width: '16px', height: '16px' }} />
            Refresh
          </button>

          <button
            onClick={handleAutoDetect}
            disabled={autoDetecting}
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: autoDetecting ? 'wait' : 'pointer',
              opacity: autoDetecting ? 0.7 : 1,
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(0, 212, 255, 0.2) 100%)',
              borderColor: 'var(--accent-cyan)'
            }}
            title="Detect printer models and match them to catalog drivers automatically"
          >
            <Sparkles style={{ width: '16px', height: '16px' }} className={autoDetecting ? 'spin' : ''} />
            {autoDetecting ? 'Detecting…' : 'Auto-detect Driver'}
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              fontWeight: 600,
              padding: '8px 16px',
              borderRadius: '8px',
              cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.2) 0%, rgba(0, 255, 136, 0.2) 100%)',
              borderColor: 'var(--accent-cyan)'
            }}
          >
            <Plus style={{ width: '16px', height: '16px' }} />
            Add Printer
          </button>
        </div>
      </div>

      {/* Auto-detect result banner */}
      {autoDetectResult && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '12px',
          padding: '14px 16px',
          marginBottom: '16px',
          borderRadius: '10px',
          border: `1px solid ${autoDetectResult.ok ? 'var(--accent-cyan)' : 'var(--accent-red, #ff4d4f)'}`,
          background: autoDetectResult.ok ? 'rgba(0, 212, 255, 0.08)' : 'rgba(255, 77, 79, 0.08)',
        }}>
          <Sparkles style={{ width: '18px', height: '18px', color: 'var(--accent-cyan)', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: autoDetectResult.details?.length ? '8px' : 0 }}>
              {autoDetectResult.message}
            </div>
            {autoDetectResult.details?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {autoDetectResult.details.map((d: any) => (
                  <div key={d.printer_id} style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'Share Tech Mono, monospace' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{d.printer_name}</span>
                    {' → '}
                    <span style={{ color: 'var(--accent-green)' }}>{d.driver_name}</span>
                    {' '}({d.confidence}, {Math.round(d.score * 100)}%)
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setAutoDetectResult(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            title="Dismiss"
          >
            <X style={{ width: '16px', height: '16px' }} />
          </button>
        </div>
      )}

      {/* TIER-1 #3: Filter Bar — search, group, tag */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        background: 'rgba(13, 17, 23, 0.6)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        marginBottom: '8px'
      }}>
        {/* Search */}
        <div style={{ position: 'relative', minWidth: '220px' }}>
          <Search style={{
            position: 'absolute', left: '10px', top: '50%',
            transform: 'translateY(-50%)',
            width: '14px', height: '14px',
            color: 'var(--text-muted)'
          }} />
          <input
            type="text"
            value={filterSearch}
            onChange={(e) => setFilterSearch(e.target.value)}
            placeholder="Search printers..."
            style={{
              width: '100%',
              padding: '8px 12px 8px 32px',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              outline: 'none'
            }}
          />
        </div>

        {/* Group filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Folder style={{ width: '14px', height: '14px', color: 'var(--accent-cyan)' }} />
          <select
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)}
            style={{
              padding: '8px 12px',
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              color: 'var(--text-primary)',
              fontSize: '13px',
              cursor: 'pointer',
              minWidth: '160px'
            }}
          >
            <option value="">All Groups ({groups.reduce((sum, g) => sum + parseInt(String(g.printer_count || 0)), 0)})</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.printer_count || 0})
              </option>
            ))}
          </select>
        </div>

        {/* Tag filter */}
        {availableTags.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <Tag style={{ width: '14px', height: '14px', color: 'var(--accent-cyan)' }} />
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              style={{
                padding: '8px 12px',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                cursor: 'pointer',
                minWidth: '120px'
              }}
            >
              <option value="">All Tags</option>
              {availableTags.map(t => (
                <option key={t} value={t}>#{t}</option>
              ))}
            </select>
          </div>
        )}

        {/* Clear filters */}
        {(filterGroup || filterTag || filterSearch) && (
          <button
            onClick={() => { setFilterGroup(''); setFilterTag(''); setFilterSearch(''); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px',
              padding: '6px 12px', fontSize: '12px',
              background: 'rgba(255, 100, 100, 0.1)',
              border: '1px solid rgba(255, 100, 100, 0.3)',
              borderRadius: '6px',
              color: '#ff6b6b',
              cursor: 'pointer'
            }}
          >
            <X style={{ width: '12px', height: '12px' }} />
            Clear
          </button>
        )}

        {/* Result count */}
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-muted)' }}>
          Showing <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{printers.length}</span> printer{printers.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* STAT CARDS ROW */}
      <div className="stat-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        
        {/* Total Printers */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Printer className="stat-icon" style={{ color: 'var(--accent-cyan)' }} />
            <span className="stat-badge cyan">Total</span>
          </div>
          <div className="stat-value">{totalPrintersCount}</div>
          <div className="stat-label">Active Printers</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: '100%', background: 'var(--accent-cyan)' }} />
          </div>
          <div className="stat-subtext">Registered local & network systems</div>
        </div>

        {/* Online Printers */}
        <div className="stat-card">
          <div className="stat-card-header">
            <CheckCircle className="stat-icon" style={{ color: 'var(--accent-green)' }} />
            <span className="stat-badge green">Online</span>
          </div>
          <div className="stat-value">{onlinePrintersCount}</div>
          <div className="stat-label">Ready Status</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ 
              width: `${(onlinePrintersCount / Math.max(totalPrintersCount, 1)) * 100}%`,
              background: 'var(--accent-green)'
            }} />
          </div>
          <div className="stat-subtext">
            <span>{onlinePrintersCount}</span> of <span>{totalPrintersCount}</span> online
          </div>
        </div>

        {/* Offline Printers */}
        <div className="stat-card">
          <div className="stat-card-header">
            <XCircle className="stat-icon" style={{ color: 'var(--accent-red)' }} />
            <span className="stat-badge" style={{ 
              background: 'rgba(255, 61, 90, 0.15)',
              border: '1px solid rgba(255, 61, 90, 0.4)',
              color: 'var(--accent-red)',
              fontSize: '10px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              padding: '4px 10px',
              borderRadius: '12px'
            }}>Offline</span>
          </div>
          <div className="stat-value">{offlinePrintersCount}</div>
          <div className="stat-label">Disconn. Nodes</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ 
              width: `${(offlinePrintersCount / Math.max(totalPrintersCount, 1)) * 100}%`,
              background: 'var(--accent-red)'
            }} />
          </div>
          <div className="stat-subtext">Requires attention or reboot</div>
        </div>

        {/* Auto-Hidden Printers */}
        <div className="stat-card">
          <div className="stat-card-header">
            <EyeOff className="stat-icon" style={{ color: 'var(--accent-amber)' }} />
            <span className="stat-badge amber">Hidden</span>
          </div>
          <div className="stat-value">{hiddenPrintersCount}</div>
          <div className="stat-label">Auto-Removed</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ 
              width: `${(hiddenPrintersCount / Math.max(totalPrintersCount + hiddenPrintersCount, 1)) * 100}%`,
              background: 'var(--accent-amber)'
            }} />
          </div>
          <div className="stat-subtext">Offline &gt; 15 min (filtered)</div>
        </div>
      </div>

      {/* AUTO-HIDDEN WARNING BANNER */}
      {showHidden && hiddenCount > 0 && (
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '8px',
            padding: '12px 16px',
            fontSize: '14px',
            color: 'var(--accent-amber)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginTop: '-8px'
          }}
        >
          <AlertTriangle style={{ width: '18px', height: '18px', flexShrink: 0 }} />
          <span>
            Showing all printers including {hiddenCount} auto-hidden (offline &gt; 15 min). They will be restored automatically when their node reconnects.
          </span>
        </div>
      )}

      {/* PRINTERS CONTAINER */}
      {printers.length === 0 ? (
        <div
          className="card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '60px 40px',
            textAlign: 'center',
            background: 'linear-gradient(180deg, var(--bg-card) 0%, rgba(17, 28, 48, 0.4) 100%)',
            border: '1px dashed var(--border)'
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              background: 'rgba(0, 212, 255, 0.05)',
              border: '1px solid rgba(0, 212, 255, 0.2)',
              boxShadow: 'var(--glow-cyan)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px',
              position: 'relative'
            }}
          >
            <Printer style={{ width: '40px', height: '40px', color: 'var(--accent-cyan)' }} />
            <div
              style={{
                position: 'absolute',
                bottom: '0',
                right: '0',
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <AlertTriangle style={{ width: '12px', height: '12px', color: 'var(--accent-amber)' }} />
            </div>
          </div>

          <h3 style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', color: 'var(--text-primary)', marginBottom: '8px', letterSpacing: '1px' }}>
            NO ACTIVE PRINTERS DETECTED
          </h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: '460px', fontSize: '14px', lineHeight: 1.6, marginBottom: '24px' }}>
            Your PrintServer node is currently standalone. Connect print hardware via USB, IP, or standard system drivers to initiate active queues.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-primary"
            style={{ padding: '12px 24px', fontSize: '14px' }}
          >
            <Plus style={{ width: '18px', height: '18px' }} /> Add Printer Node
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {displayPrinters.map((printer) => {
            const currentPaper = printer.config?.paper?.size || null;
            const effectivePaper = currentPaper || paperDefault;
            const isAutoRemoved = printer.config?.auto_removed === 'true';
            const isDropdownOpen = paperDropdown === printer.id;
            const isSaving = savingPaper === printer.id;
            
            const statusConfig = getStatusStyle(printer.status);

            return (
              <div
                key={printer.id}
                className="card printer-card"
                style={{
                  opacity: isAutoRemoved ? 0.6 : 1,
                  borderColor: isAutoRemoved ? 'rgba(245, 158, 11, 0.3)' : 'var(--border)',
                  borderStyle: isAutoRemoved ? 'dashed' : 'solid',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              >
                
                {/* CARD HEADER */}
                <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        backgroundColor: statusConfig.color,
                        boxShadow: statusConfig.glow,
                        animation: 'statusPulse 2s ease-in-out infinite'
                      }} />
                      {/* A faint outer pulsing ring */}
                      <div style={{
                        position: 'absolute',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: `2px solid ${statusConfig.color}`,
                        opacity: 0.2,
                        animation: 'pulse-status 2.5s ease-in-out infinite'
                      }} />
                    </div>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {printer.name}
                      </h3>
                      <span style={{ fontSize: '11px', fontFamily: 'Share Tech Mono, monospace', color: 'var(--accent-cyan)', textTransform: 'uppercase' }}>
                        {printer.type}
                      </span>
                      {printer.client_hostname && (
                        <span title={`Hosted on node ${printer.client_hostname}${printer.client_ip ? ' (' + printer.client_ip + ')' : ''}`} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          marginLeft: '8px', fontSize: '10px',
                          fontFamily: 'Share Tech Mono, monospace',
                          padding: '2px 7px', borderRadius: '4px',
                          background: 'rgba(0, 212, 255, 0.08)',
                          border: '1px solid rgba(0, 212, 255, 0.25)',
                          color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '0.5px',
                        }}>
                          <Monitor size={10} /> {printer.client_hostname}
                        </span>
                      )}
                    </div>
                  </div>
                  {isAutoRemoved && (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      color: 'var(--accent-amber)',
                      borderRadius: '10px',
                      padding: '2px 8px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      Hidden
                    </span>
                  )}
                </div>

                {/* INFO LIST */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, marginTop: '20px', width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500 }}>Driver</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'Share Tech Mono, monospace' }}>
                      {printer.driver_name || (printer.driver && printer.driver !== 'Unknown' ? printer.driver : 'N/A')}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500 }}>Port</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '140px', fontFamily: 'Share Tech Mono, monospace' }} title={printer.port}>
                      {printer.port || 'N/A'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500 }}>Group</span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: printer.group_name ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {printer.group_name || 'None'}
                    </span>
                  </div>

                  {/* TIER-1 #3: Tags chips */}
                  {Array.isArray(printer.tags) && printer.tags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', paddingTop: '4px' }}>
                      {printer.tags.map((tag: string) => (
                        <span
                          key={tag}
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            fontSize: '10px',
                            fontWeight: 600,
                            color: 'var(--accent-cyan)',
                            background: 'rgba(0, 212, 255, 0.1)',
                            border: '1px solid rgba(0, 212, 255, 0.3)',
                            borderRadius: '10px',
                            fontFamily: 'Share Tech Mono, monospace'
                          }}
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {/* PAPER CONFIG SELECTOR */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <FileText style={{ width: '14px', height: '14px', color: 'var(--accent-cyan)' }} /> Paper Size
                    </span>
                    
                    <div style={{ position: 'relative' }} data-paper-dropdown>
                      <button
                        onClick={(e) => { e.stopPropagation(); setPaperDropdown(isDropdownOpen ? null : printer.id); }}
                        disabled={isSaving}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          border: currentPaper ? '1px solid rgba(0, 212, 255, 0.4)' : '1px solid var(--border)',
                          background: currentPaper ? 'rgba(0, 212, 255, 0.1)' : 'var(--bg-secondary)',
                          color: currentPaper ? 'var(--accent-cyan)' : 'var(--text-primary)',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          fontWeight: 600
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                          if (!currentPaper) e.currentTarget.style.background = 'var(--bg-hover)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = currentPaper ? 'rgba(0, 212, 255, 0.4)' : 'var(--border)';
                          if (!currentPaper) e.currentTarget.style.background = 'var(--bg-secondary)';
                        }}
                      >
                        {isSaving ? (
                          <RefreshCw style={{ width: '12px', height: '12px', animation: 'spin 1s linear infinite' }} />
                        ) : (
                          <>
                            <span>{effectivePaper}</span>
                            {!currentPaper && <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '2px' }}>(default)</span>}
                            {printer.config?.paper?.orientation === 'landscape' && <span style={{ marginLeft: '4px', color: 'var(--accent-amber)', fontSize: '10px', fontWeight: 'bold' }}>L</span>}
                            <ChevronDown style={{ width: '12px', height: '12px', opacity: 0.7 }} />
                          </>
                        )}
                      </button>

                      {isDropdownOpen && (
                        <div
                          className="card"
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '32px',
                            zIndex: 100,
                            width: '240px',
                            maxHeight: '260px',
                            overflowY: 'auto',
                            padding: '8px 0',
                            display: 'flex',
                            flexDirection: 'column'
                          }}
                        >
                          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Select Paper Size
                            </span>
                            {currentPaper && (
                              <button
                                onClick={() => handleResetPaper(printer.id)}
                                style={{
                                  background: 'transparent',
                                  border: 'none',
                                  color: 'var(--accent-amber)',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  padding: 0,
                                  textAlign: 'left',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                <RefreshCw style={{ width: '10px', height: '10px' }} /> Reset to default ({paperDefault})
                              </button>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {paperSizes.map((size) => (
                              <button
                                key={size.name}
                                onClick={() => handlePaperChange(printer.id, size.name)}
                                style={{
                                  width: '100%',
                                  textAlign: 'left',
                                  padding: '8px 12px',
                                  fontSize: '13px',
                                  background: effectivePaper === size.name ? 'rgba(0, 212, 255, 0.08)' : 'transparent',
                                  border: 'none',
                                  color: effectivePaper === size.name ? 'var(--accent-cyan)' : 'var(--text-primary)',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = 'var(--bg-hover)';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = effectivePaper === size.name ? 'rgba(0, 212, 255, 0.08)' : 'transparent';
                                }}
                              >
                                <span style={{ fontWeight: effectivePaper === size.name ? 600 : 400 }}>
                                  {size.name}
                                  {!size.builtin && (
                                    <span style={{ marginLeft: '6px', fontSize: '10px', color: 'var(--accent-amber)', fontWeight: 'bold' }}>
                                      [custom]
                                    </span>
                                  )}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'Share Tech Mono, monospace' }}>
                                  {size.widthMm}×{size.heightMm}mm
                                </span>
                              </button>
                            ))}
                            {paperSizes.length === 0 && (
                              <div style={{ padding: '16px 12px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
                                No paper sizes. Add in Settings → Print Defaults.
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {printer.config?.restored_at && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid rgba(30, 48, 80, 0.5)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Last Restored</span>
                      <span style={{ color: 'var(--accent-green)', fontFamily: 'Share Tech Mono, monospace' }}>
                        {new Date(printer.config.restored_at).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                {/* CARD TOOLBAR ROW */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)', width: '100%' }}>
                  <Link
                    href={`/printers/${printer.id}`}
                    className="btn-primary"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: '12px',
                      justifyContent: 'center',
                      minHeight: '36px',
                      height: '36px'
                    }}
                  >
                    View Jobs
                  </Link>
                  
                  {isAutoRemoved && (
                    <button
                      onClick={async () => {
                        await printersApi.restore(printer.id);
                        fetchPrinters();
                        fetchHiddenCount();
                      }}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        border: '1px solid rgba(0, 255, 136, 0.3)',
                        background: 'rgba(0, 255, 136, 0.1)',
                        color: 'var(--accent-green)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 255, 136, 0.2)';
                        e.currentTarget.style.boxShadow = 'var(--glow-green)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(0, 255, 136, 0.1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                      title="Restore (un-hide) this printer"
                    >
                      <RefreshCw style={{ width: '16px', height: '16px' }} />
                    </button>
                  )}

                  <button
                    onClick={() => handleTestPrint(printer.id)}
                    disabled={actionLoading[`test-${printer.id}`]}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid rgba(0, 212, 255, 0.3)',
                      background: 'rgba(0, 212, 255, 0.1)',
                      color: 'var(--accent-cyan)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 212, 255, 0.2)';
                      e.currentTarget.style.boxShadow = 'var(--glow-cyan)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    title="Send Test Print Page"
                  >
                    {actionLoading[`test-${printer.id}`] ? (
                      <RefreshCw style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Play style={{ width: '16px', height: '16px' }} />
                    )}
                  </button>

                  <button
                    onClick={() => handleClearQueue(printer.id)}
                    disabled={actionLoading[`clear-${printer.id}`]}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      background: 'rgba(245, 158, 11, 0.1)',
                      color: 'var(--accent-amber)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)';
                      e.currentTarget.style.boxShadow = 'var(--glow-amber)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    title="Clear Active Print Queue"
                  >
                    {actionLoading[`clear-${printer.id}`] ? (
                      <RefreshCw style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Ban style={{ width: '16px', height: '16px' }} />
                    )}
                  </button>
                  
                  {/* Edit Button */}
                  <button
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-secondary)',
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                      e.currentTarget.style.boxShadow = 'var(--glow-cyan)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    title="Edit Printer Config"
                  >
                    <Edit style={{ width: '16px', height: '16px' }} />
                  </button>

                  {/* Paper Config Button */}
                  <button
                    onClick={() => setPaperConfigPrinter({ id: printer.id, name: printer.name })}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid rgba(0, 212, 255, 0.3)',
                      background: 'rgba(0, 212, 255, 0.1)',
                      color: 'var(--accent-cyan)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 212, 255, 0.2)';
                      e.currentTarget.style.boxShadow = 'var(--glow-cyan)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    title="Atur ukuran kertas default printer ini"
                  >
                    <FileText style={{ width: '16px', height: '16px' }} />
                  </button>

                  {/* Download Installer (.bat) Button — per-printer, auto port + driver */}
                  <a
                    href={`/downloads/printer-bat/${printer.slug || ''}`}
                    download
                    title="Download installer .bat khusus printer ini (auto port + driver)"
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid rgba(0, 255, 136, 0.3)',
                      background: 'rgba(0, 255, 136, 0.1)',
                      color: 'var(--accent-green)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textDecoration: 'none'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 255, 136, 0.2)';
                      e.currentTarget.style.boxShadow = 'var(--glow-green)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(0, 255, 136, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <Download style={{ width: '16px', height: '16px' }} />
                  </a>

                  {/* Delete Button */}
                  <button
                    onClick={async () => {
                      if (!confirm('Are you sure you want to delete this printer?')) return;
                      try {
                        await printersApi.delete(printer.id);
                        fetchPrinters();
                        fetchHiddenCount();
                      } catch (e: any) {
                        alert(`Failed to delete: ${e.response?.data?.error || e.message}`);
                      }
                    }}
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 61, 90, 0.3)',
                      background: 'rgba(255, 61, 90, 0.1)',
                      color: 'var(--accent-red)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 61, 90, 0.2)';
                      e.currentTarget.style.boxShadow = 'var(--glow-red)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 61, 90, 0.1)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    title="Delete Printer"
                  >
                    <Trash2 style={{ width: '16px', height: '16px' }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <AddPrinterModal
          onClose={() => setShowAddModal(false)}
          onCreated={() => { fetchPrinters(); fetchHiddenCount(); }}
        />
      )}

      {paperConfigPrinter && (
        <PrinterPaperConfig
          printerId={paperConfigPrinter.id}
          printerName={paperConfigPrinter.name}
          onClose={() => { setPaperConfigPrinter(null); fetchPrinters(); }}
        />
      )}
    </div>
  );
}