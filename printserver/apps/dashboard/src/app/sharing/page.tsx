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
  type: string;
  tags: string[];
  node_hostname: string;
  node_ip: string;
  node_online: boolean;
  has_bat: boolean;
}

interface Stats {
  total_nodes: number;
  active_nodes: number;
  inactive_nodes: number;
  total_printers: number;
  active_printers: number;
  inactive_printers: number;
  total_pages: number;
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
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_URL}/api/sharing/data`);
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

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
      return matchSearch && matchNode && matchStatus;
    });
  }, [data, search, selectedNode, statusFilter]);

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

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>⏳</div>
            Loading...
          </div>
        )}

        {error && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--accent-red)',
            borderRadius: '12px', padding: '24px', textAlign: 'center',
            color: 'var(--accent-red)',
          }}>
            Error: {error}
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

            {/* Total Halaman - full width card */}
            <div style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--accent-cyan)',
              borderRadius: '12px',
              padding: '20px 24px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              position: 'relative',
            }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '10px',
                background: 'rgba(0, 212, 255, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '22px', flexShrink: 0,
              }}>📄</div>
              <div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: 'var(--accent-cyan)', lineHeight: 1 }}>
                  {data.stats.total_pages}
                </div>
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
              {/* Row 1: Search - full width, large */}
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
              {/* Row 2: Node + Status dropdowns - side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {/* Node Search Dropdown */}
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
                      padding: '10px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      outline: 'none',
                      cursor: 'text',
                      minWidth: 0,
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
                {/* Status filter */}
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
                    minWidth: 0,
                  }}
                >
                  <option value="all">Semua Status</option>
                  <option value="online">🟢 Online</option>
                  <option value="offline">🔴 Offline</option>
                </select>
              </div>
              {/* Row 3: Install Agent button - full width */}
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
                  fontSize: '14px',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  transition: 'opacity 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                ⬇️ Install Agent Node (.bat)
              </a>
            </div>

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
              {filteredPrinters.map(printer => (
                <div key={printer.id} style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '16px',
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent-cyan)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                >
                  {/* Printer Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: '600', marginBottom: '4px' }}>
                        {printer.name}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {printer.driver || 'No driver'}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>IP</span>
                      <span style={{ fontFamily: 'monospace' }}>{printer.node_ip || '-'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Port</span>
                      <span style={{ fontFamily: 'monospace' }}>{printer.raw_port || '-'}</span>
                    </div>
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
                      href={`/downloads/printer-bat/${printer.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}`}
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
              ))}
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
