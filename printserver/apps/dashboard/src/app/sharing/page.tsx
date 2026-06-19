'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface Node {
  id: number;
  hostname: string;
  ip_address: string;
  is_online: boolean;
  version: string;
  last_seen: string;
}

interface Printer {
  id: number;
  name: string;
  status: string;
  raw_port: number | null;
  driver: string;
  driver_name?: string | null;
  type: string;
  tags: string[];
  node_hostname: string;
  node_ip: string;
  node_online: boolean;
  node_last_seen: string | null;
  printer_updated_at: string | null;
  has_bat: boolean;
  slug?: string;
  is_node_only?: boolean;
  driver_match?: {
    expected_driver: string | null;
    expected_driver_id?: number;
    score: number;
    confidence: 'high' | 'medium' | 'low' | null;
    matched: boolean;
    reasons: string[];
  } | null;
}

interface AutoDetectDetail {
  printer_id: number;
  printer_name: string;
  matched: boolean;
  driver_id?: number;
  driver_name?: string;
  score?: number;
  confidence?: 'high' | 'medium' | 'low';
  changed?: boolean;
  reasons?: string[];
}

interface AutoDetectResult {
  ok: boolean;
  applied: number;
  matched: number;
  unmatched: number;
  message: string;
  details: AutoDetectDetail[];
}

interface Stats {
  total_nodes: number;
  active_nodes: number;
  inactive_nodes: number;
  total_printers: number;
  active_printers: number;
  inactive_printers: number;
  total_pages: number;
  daily_pages: number;
  weekly_pages: number;
  monthly_pages: number;
}

interface Data {
  nodes: Node[];
  stats: Stats;
  printers: Printer[];
}

export default function SharingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<string>('all');
  const [nodeSearch, setNodeSearch] = useState('');
  const [nodeDropdownOpen, setNodeDropdownOpen] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [nodeStatusFilter, setNodeStatusFilter] = useState<string>('all');
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [pollProgress, setPollProgress] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectResult, setAutoDetectResult] = useState<AutoDetectResult | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('ps-theme');
    if (saved === 'light') setTheme('light');
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('ps-theme', next);
  };

  // Click outside to close node dropdown
  useEffect(() => {
    if (!nodeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (nodeRef.current && !nodeRef.current.contains(e.target as HTMLElement)) {
        setNodeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [nodeDropdownOpen]);

  // Build node list with online status from data
  const nodeList = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, boolean>();
    data.nodes.forEach(n => map.set(n.hostname, n.is_online));
    return Array.from(new Set(data.printers.map(p => p.node_hostname)))
      .filter(n => n !== 'Unassigned')
      .sort((a, b) => a.localeCompare(b));
  }, [data]);

  // Filter nodes by search text
  const filteredNodes = useMemo(() => {
    if (!nodeSearch) return nodeList;
    const q = nodeSearch.toLowerCase();
    return nodeList.filter(n => n.toLowerCase().includes(q));
  }, [nodeList, nodeSearch]);

  // Compute online status for each node name
  const nodeOnlineMap = useMemo(() => {
    if (!data) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    data.nodes.forEach(n => map.set(n.hostname, n.is_online));
    return map;
  }, [data]);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/sharing/data`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
      setError(null); // clear any previous error on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  // Polling progress animation
  useEffect(() => {
    setPollProgress(0);
    const start = Date.now();
    const duration = 30000;
    const tick = () => {
      const elapsed = Date.now() - start;
      setPollProgress(Math.min((elapsed / duration) * 100, 100));
      if (elapsed < duration) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data]);

  const nodeNames = useMemo(() => {
    if (!data) return [];
    return Array.from(new Set(data.printers.map(p => p.node_hostname))).filter(n => n !== 'Unassigned');
  }, [data]);

  const filteredPrinters = useMemo(() => {
    if (!data) return [];
    return data.printers.filter(p => {
      const matchSearch = !search || 
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.node_hostname.toLowerCase().includes(search.toLowerCase()) ||
        p.driver?.toLowerCase().includes(search.toLowerCase());
      const matchNode = selectedNode === 'all' || p.node_hostname === selectedNode;
      const effectiveStatus = !p.node_online ? 'offline' : p.status;
      const matchStatus = statusFilter === 'all' || effectiveStatus === statusFilter;
      const matchNodeStatus = nodeStatusFilter === 'all'
        || (nodeStatusFilter === 'online' && p.node_online)
        || (nodeStatusFilter === 'offline' && !p.node_online);
      return matchSearch && matchNode && matchStatus && matchNodeStatus;
    });
  }, [data, search, selectedNode, statusFilter, nodeStatusFilter]);

  const getStatusColor = (status: string, nodeOnline: boolean) => {
    if (!nodeOnline) return 'var(--accent-red)';
    if (status === 'online') return 'var(--accent-green)';
    if (status === 'offline') return 'var(--accent-amber)';
    return 'var(--text-muted)';
  };

  const getStatusLabel = (status: string, nodeOnline: boolean) => {
    if (!nodeOnline) return 'Node Offline';
    if (status === 'online') return 'Online';
    if (status === 'offline') return 'Offline';
    return status;
  };

  const formatTime = (ts: string) => {
    if (!ts) return '-';
    const d = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return 'Baru saja';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m lalu`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}j lalu`;
    return d.toLocaleDateString('id-ID');
  };

  const copyIp = (ip: string) => {
    if (!ip) return;
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 1500);
  };

  // Smart driver auto-detect: previews matches (dry-run), then applies if
  // any changes are found. Re-evaluates all printers (including already-assigned).
  // Uses the public /api/sharing/auto-detect endpoint (no JWT required).
  const handleAutoDetect = async () => {
    setAutoDetecting(true);
    setAutoDetectResult(null);
    try {
      // 1) Dry-run to compute matches without writing.
      const previewRes = await fetch(`${API_URL}/api/sharing/auto-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: true, reassign: true }),
      });
      if (!previewRes.ok) throw new Error(`HTTP ${previewRes.status}`);
      const preview = await previewRes.json();
      const toChange = (preview.results || []).filter((r: AutoDetectDetail) => r.matched && r.changed);

      if (toChange.length === 0) {
        const matched = preview.matched || 0;
        setAutoDetectResult({
          ok: true,
          applied: 0,
          matched,
          unmatched: preview.unmatched || 0,
          message: matched > 0
            ? `All ${matched} matched printer(s) already have the correct driver.`
            : 'No confident driver matches found.',
          details: [],
        });
        return;
      }

      // 2) Apply for real.
      const applyRes = await fetch(`${API_URL}/api/sharing/auto-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false, reassign: true }),
      });
      if (!applyRes.ok) throw new Error(`HTTP ${applyRes.status}`);
      const applied = await applyRes.json();
      setAutoDetectResult({
        ok: true,
        applied: applied.assigned || 0,
        matched: applied.matched || 0,
        unmatched: applied.unmatched || 0,
        details: toChange,
        message: `Auto-assigned ${applied.assigned || 0} driver(s).`,
      });
      // Re-fetch the data so cards reflect the new driver assignments.
      await fetchData();
    } catch (err) {
      setAutoDetectResult({
        ok: false,
        applied: 0,
        matched: 0,
        unmatched: 0,
        details: [],
        message: err instanceof Error ? err.message : 'Auto-detect failed. Check server logs.',
      });
    } finally {
      setAutoDetecting(false);
    }
  };

  return (
    <>
    <style jsx global>{`
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: 'IBM Plex Sans', -apple-system, sans-serif;
        background: var(--bg-primary);
        color: var(--text-primary);
        min-height: 100vh;
      }
      :root, [data-theme="dark"] {
        --bg-primary: #090e1a;
        --bg-card: #111c30;
        --bg-hover: #162236;
        --accent-cyan: #00d4ff;
        --accent-green: #00ff88;
        --accent-red: #ff3d5a;
        --accent-amber: #f59e0b;
        --text-primary: #e2f0ff;
        --text-muted: #4a6080;
        --border: #1e3050;
      }
      [data-theme="light"] {
        --bg-primary: #f0f4f8;
        --bg-card: #ffffff;
        --bg-hover: #f8fafc;
        --accent-cyan: #0891b2;
        --accent-green: #059669;
        --accent-red: #dc2626;
        --accent-amber: #d97706;
        --text-primary: #0f172a;
        --text-muted: #64748b;
        --border: #e2e8f0;
      }
    `}</style>
    <style jsx global>{`
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    `}</style>
    <div data-theme={theme} style={{ minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <header style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '8px',
            background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-green))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px', fontWeight: '700', color: '#000',
          }}>P</div>
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: '600' }}>PrintServer Pro</h1>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Printer Sharing</p>
          </div>
        </div>
        <button onClick={toggleTheme} style={{
          background: 'var(--bg-hover)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '8px 12px', color: 'var(--text-primary)',
          cursor: 'pointer', fontSize: '14px',
        }}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </header>

      {/* Polling progress bar */}
      {data && (
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '0 24px',
        }}>
          <div style={{
            height: '3px',
            background: 'var(--border)',
            borderRadius: '0 0 4px 4px',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${pollProgress}%`,
              background: loading
                ? 'var(--accent-amber)'
                : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-green))',
              borderRadius: '0 0 4px 4px',
              transition: loading ? 'none' : 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
            Loading...
          </div>
        )}

        {error && (
          <div style={{
            background: 'rgba(255,61,90,0.08)',
            border: '1px solid rgba(255,61,90,0.25)',
            borderRadius: '10px',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'var(--accent-red)',
            fontSize: '13px',
          }}>
            <span>⚠️ {error}</span>
            <button
              onClick={() => fetchData()}
              style={{
                background: 'rgba(255,61,90,0.15)',
                border: '1px solid rgba(255,61,90,0.3)',
                borderRadius: '6px',
                padding: '6px 14px',
                color: 'var(--accent-red)',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {data && (
          <>
            {/* Stats Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px',
              marginBottom: '24px',
            }}>
              {[
                { value: data.stats.active_nodes, color: 'var(--accent-green)', icon: '🖥️', accent: '#00ff88' },
                { value: data.stats.inactive_nodes, color: 'var(--accent-red)', icon: '💤', accent: '#ff3d5a' },
                { value: data.stats.active_printers, color: 'var(--accent-green)', icon: '🖨️', accent: '#00ff88' },
                { value: data.stats.inactive_printers, color: 'var(--accent-amber)', icon: '📴', accent: '#f59e0b' },
              ].map((stat, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderLeft: `3px solid ${stat.accent}`,
                  borderRadius: '12px',
                  padding: '16px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  position: 'relative',
                }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: `${stat.accent}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '20px', flexShrink: 0,
                  }}>{stat.icon}</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: stat.color, lineHeight: 1 }}>
                    {stat.value}
                  </div>
                  <div style={{
                    position: 'absolute', top: '12px', right: '12px',
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: stat.accent,
                  }} />
                </div>
              ))}
            </div>

            {/* Total Halaman - single card, stacked */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '24px',
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <span style={{ fontSize: '18px' }}>📄</span>
                <span style={{ fontSize: '14px', fontWeight: '600' }}>Total Halaman</span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                  {data.stats.total_pages} keseluruhan
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  { label: 'Hari Ini', value: data.stats.daily_pages, color: 'var(--accent-green)', icon: '☀️' },
                  { label: 'Minggu Ini', value: data.stats.weekly_pages, color: 'var(--accent-cyan)', icon: '🌤️' },
                  { label: 'Bulan Ini', value: data.stats.monthly_pages, color: 'var(--accent-purple, #a78bfa)', icon: '🌙' },
                ].map((seg, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--bg-hover)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '16px' }}>{seg.icon}</span>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{seg.label}</span>
                    </div>
                    <span style={{ fontSize: '16px', fontWeight: '700', color: seg.color }}>
                      {seg.value}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{
                position: 'absolute', top: '14px', right: '14px',
                width: '8px', height: '8px', borderRadius: '50%',
                background: 'var(--accent-cyan)',
              }} />
            </div>

            {/* Toolbar */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              marginBottom: '20px',
            }}>
              {/* Row 1: Search */}
              <input
                type="text"
                placeholder="🔍 Cari printer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
              {/* Row 2: Node Search Dropdown */}
              <div ref={nodeRef} style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="🖥️ Cari node..."
                  value={nodeDropdownOpen ? nodeSearch : (selectedNode === 'all' ? '' : selectedNode)}
                  onFocus={() => { setNodeDropdownOpen(true); setNodeSearch(''); }}
                  onChange={(e) => { setNodeSearch(e.target.value); if (!nodeDropdownOpen) setNodeDropdownOpen(true); }}
                  style={{
                    width: '100%',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '10px 14px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'text',
                  }}
                />
                {nodeDropdownOpen && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '4px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    maxHeight: '240px',
                    overflowY: 'auto',
                    zIndex: 100,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  }}>
                    <div
                      onClick={() => { setSelectedNode('all'); setNodeSearch(''); setNodeDropdownOpen(false); }}
                      style={{
                        padding: '10px 14px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: selectedNode === 'all' ? '600' : '400',
                        color: selectedNode === 'all' ? 'var(--accent-cyan)' : 'var(--text-primary)',
                        background: selectedNode === 'all' ? 'var(--bg-hover)' : 'transparent',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      Semua Node
                    </div>
                    {filteredNodes.map(n => (
                      <div
                        key={n}
                        onClick={() => { setSelectedNode(n); setNodeSearch(''); setNodeDropdownOpen(false); }}
                        style={{
                          padding: '10px 14px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: selectedNode === n ? '600' : '400',
                          color: selectedNode === n ? 'var(--accent-cyan)' : 'var(--text-primary)',
                          background: selectedNode === n ? 'var(--bg-hover)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <span style={{
                          width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                          background: nodeOnlineMap.get(n) ? 'var(--accent-green)' : 'var(--accent-red)',
                        }} />
                        {n}
                      </div>
                    ))}
                    {filteredNodes.length === 0 && (
                      <div style={{ padding: '12px 14px', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                        Tidak ditemukan
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* Row 3: Node Status + Printer Status */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <select
                  value={nodeStatusFilter}
                  onChange={(e) => setNodeStatusFilter(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">🖥️ Semua Node</option>
                  <option value="online">🟢 Node Online</option>
                  <option value="offline">🔴 Node Offline</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="all">🖨️ Semua Printer</option>
                  <option value="online">🟢 Printer Online</option>
                  <option value="offline">🔴 Printer Offline</option>
                </select>
              </div>
              {/* Row 4: Auto-detect + Install Agent buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  onClick={handleAutoDetect}
                  disabled={autoDetecting}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.2) 0%, rgba(0, 212, 255, 0.2) 100%)',
                    color: 'var(--accent-cyan)',
                    fontWeight: '600',
                    fontSize: '13px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--accent-cyan)',
                    cursor: autoDetecting ? 'wait' : 'pointer',
                    opacity: autoDetecting ? 0.7 : 1,
                    transition: 'opacity 0.2s',
                  }}
                  title="Auto-detect printer models and match them to drivers"
                >
                  <span style={{ fontSize: '14px', animation: autoDetecting ? 'spin 1s linear infinite' : 'none', display: 'inline-block' }}>✨</span>
                  {autoDetecting ? 'Detecting…' : 'Auto-detect Driver'}
                </button>
                <a
                  href="/downloads/install-agent.bat"
                  download
                  title="Download Agent Node Installer (.bat)"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-green))',
                    color: '#000',
                    fontWeight: '600',
                    fontSize: '13px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    textDecoration: 'none',
                    transition: 'opacity 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  ⬇️ Install Agent (.bat)
                </a>
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
                border: `1px solid ${autoDetectResult.ok ? 'var(--accent-cyan)' : 'var(--accent-red)'}`,
                background: autoDetectResult.ok ? 'rgba(0, 212, 255, 0.08)' : 'rgba(255, 61, 90, 0.08)',
              }}>
                <span style={{ fontSize: '18px', color: 'var(--accent-cyan)', flexShrink: 0, marginTop: '2px' }}>✨</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: autoDetectResult.details?.length ? '8px' : 0 }}>
                    {autoDetectResult.message}
                  </div>
                  {autoDetectResult.details?.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {autoDetectResult.details.map((d) => (
                        <div key={d.printer_id} style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{d.printer_name}</span>
                          {' → '}
                          <span style={{ color: 'var(--accent-green)' }}>{d.driver_name}</span>
                          {' '}({d.confidence})
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setAutoDetectResult(null)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontSize: '16px' }}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Results count */}
            <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>
              Menampilkan {filteredPrinters.length} dari {data.printers.length} printer
            </div>

            {/* Printer Cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: '16px',
            }}>
              {filteredPrinters.map(printer => {
                const cardBorder = !printer.node_online
                  ? 'var(--accent-red)'
                  : printer.status === 'online' ? 'var(--accent-green)' : 'var(--accent-amber)';
                return (
                <div key={printer.id} style={{
                  background: 'var(--bg-card)',
                  border: `1px solid ${cardBorder}33`,
                  borderLeft: `3px solid ${cardBorder}`,
                  borderRadius: '12px',
                  padding: '16px',
                  transition: 'border-color 0.2s',
                  opacity: printer.node_online ? 1 : 0.7,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-cyan)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  {/* Printer Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span>{printer.name}</span>
                        {/* Driver match indicator */}
                        {printer.driver_match && printer.type !== 'placeholder' && (
                          <span
                            title={
                              printer.driver_match.matched
                                ? `Driver match (${printer.driver_match.confidence}, ${Math.round((printer.driver_match.score || 0) * 100)}%): ${printer.driver_match.expected_driver || ''}`
                                : printer.driver_match.expected_driver
                                  ? `Mismatch — expected: ${printer.driver_match.expected_driver} (${printer.driver_match.confidence}, ${Math.round((printer.driver_match.score || 0) * 100)}%)`
                                  : 'No confident driver match found in catalog'
                            }
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '20px',
                              height: '20px',
                              borderRadius: '50%',
                              fontSize: '12px',
                              fontWeight: 700,
                              flexShrink: 0,
                              color: printer.driver_match.matched ? 'var(--accent-green)' : 'var(--accent-red)',
                              background: printer.driver_match.matched ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 61, 90, 0.15)',
                              border: `1px solid ${printer.driver_match.matched ? 'var(--accent-green)' : 'var(--accent-red)'}`,
                            }}
                          >
                            {printer.driver_match.matched ? '✓' : '✕'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: printer.type === 'placeholder' ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
                        {printer.type === 'placeholder'
                          ? '⚠️ Node tanpa printer'
                          : (printer.driver_name || printer.driver || 'No driver')}
                        {printer.driver_match && !printer.driver_match.matched && printer.driver_match.expected_driver && printer.type !== 'placeholder' && (
                          <span style={{ color: 'var(--accent-amber)', marginLeft: '4px' }}>
                            → {printer.driver_match.expected_driver}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      fontSize: '12px', fontWeight: '500',
                      color: getStatusColor(printer.status, printer.node_online),
                    }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: getStatusColor(printer.status, printer.node_online),
                      }} />
                      {getStatusLabel(printer.status, printer.node_online)}
                    </div>
                  </div>

                  {/* Node Info */}
                  <div style={{
                    background: 'var(--bg-hover)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    marginBottom: '12px',
                    fontSize: '12px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Node</span>
                      <span style={{ fontWeight: '500' }}>{printer.node_hostname}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>IP</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontFamily: 'monospace' }}>{printer.node_ip || '-'}</span>
                        {printer.node_ip && (
                          <button
                            onClick={() => copyIp(printer.node_ip)}
                            style={{
                              background: 'none',
                              border: '1px solid var(--border)',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              cursor: 'pointer',
                              fontSize: '11px',
                              color: copiedIp === printer.node_ip ? 'var(--accent-green)' : 'var(--text-muted)',
                              transition: 'color 0.2s',
                            }}
                            title="Copy IP"
                          >
                            {copiedIp === printer.node_ip ? '✓' : '📋'}
                          </button>
                        )}
                      </div>
                    </div>
                    {printer.node_last_seen && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>🖥️ Node</span>
                        <span>{formatTime(printer.node_last_seen)}</span>
                      </div>
                    )}
                    {printer.printer_updated_at && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {printer.status === 'online' ? '🖨️ Aktif' : '🖨️ Status'}
                        </span>
                        <span style={{ color: printer.status === 'online' ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {formatTime(printer.printer_updated_at)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Tags */}
                  {printer.tags && printer.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                      {printer.tags.map((tag, i) => (
                        <span key={i} style={{
                          background: 'rgba(0, 212, 255, 0.1)',
                          color: 'var(--accent-cyan)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: '500',
                        }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Install Button */}
                  {printer.has_bat && (
                    <a
                      href={`/downloads/printer-bat/${printer.slug || printer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 200) || 'printer'}`}
                      download
                      style={{
                        display: 'block',
                        textAlign: 'center',
                        background: 'linear-gradient(135deg, var(--accent-cyan), var(--accent-green))',
                        color: '#000',
                        fontWeight: '600',
                        fontSize: '13px',
                        padding: '8px 12px',
                        borderRadius: '8px',
                        textDecoration: 'none',
                        transition: 'opacity 0.2s',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                    >
                      ⬇️ Install Printer (.bat)
                    </a>
                  )}
                </div>
              )})}
            </div>

            {filteredPrinters.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '60px',
                color: 'var(--text-muted)',
              }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔍</div>
                Tidak ada printer ditemukan
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '24px',
        color: 'var(--text-muted)',
        fontSize: '12px',
        borderTop: '1px solid var(--border)',
        marginTop: '40px',
      }}>
        PrintServer Pro — Enterprise Print Management
      </footer>
    </div>
    </>
  );
}
