'use client';

import { useState, useEffect, useMemo } from 'react';

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
      return matchSearch && matchNode;
    });
  }, [data, search, selectedNode]);

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
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '12px',
              marginBottom: '24px',
            }}>
              {[
                { label: 'Node Aktif', value: data.stats.active_nodes, total: data.stats.total_nodes, color: 'var(--accent-green)', icon: '🖥️' },
                { label: 'Node Offline', value: data.stats.inactive_nodes, total: data.stats.total_nodes, color: 'var(--accent-red)', icon: '💤' },
                { label: 'Printer Aktif', value: data.stats.active_printers, total: data.stats.total_printers, color: 'var(--accent-green)', icon: '🖨️' },
                { label: 'Printer Offline', value: data.stats.inactive_printers, total: data.stats.total_printers, color: 'var(--accent-amber)', icon: '📴' },
                { label: 'Total Halaman', value: data.stats.total_pages, color: 'var(--accent-cyan)', icon: '📄' },
              ].map((stat, i) => (
                <div key={i} style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}>
                  <div style={{ fontSize: '24px' }}>{stat.icon}</div>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: stat.color }}>
                      {stat.value}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {stat.label}
                      {stat.total !== undefined && ` / ${stat.total}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Toolbar */}
            <div style={{
              display: 'flex',
              gap: '12px',
              marginBottom: '20px',
              flexWrap: 'wrap',
            }}>
              <input
                type="text"
                placeholder="🔍 Cari printer, node, atau driver..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: '200px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
              <select
                value={selectedNode}
                onChange={(e) => setSelectedNode(e.target.value)}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  outline: 'none',
                  cursor: 'pointer',
                  minWidth: '180px',
                }}
              >
                <option value="all">Semua Node</option>
                {nodeNames.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
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
