'use client';

import { useEffect, useState } from 'react';
import { clients as clientsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  Monitor, RefreshCw, Trash2, Server, Wifi, WifiOff, Cpu, HardDrive, ShieldCheck
} from 'lucide-react';
import { format } from 'date-fns';

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClients = async () => {
    try {
      const response = await clientsApi.list();
      setClients(response.data);
    } catch (error) {
      console.error('Failed to fetch clients:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();

    const handleClientUpdate = (data: any) => {
      setClients(prev => prev.map(c => c.id === data.clientId ? { ...c, is_online: true } : c));
    };

    const handleClientOnline = (data: any) => {
      setClients(prev => prev.map(c => c.id === data.clientId ? { ...c, is_online: true } : c));
    };

    const handleClientOffline = (data: any) => {
      setClients(prev => prev.map(c => c.id === data.clientId ? { ...c, is_online: false } : c));
    };

    on('client:heartbeat', handleClientUpdate);
    on('client:online', handleClientOnline);
    on('client:offline', handleClientOffline);

    return () => {
      off('client:heartbeat', handleClientUpdate);
      off('client:online', handleClientOnline);
      off('client:offline', handleClientOffline);
    };
  }, []);

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this client?')) {
      try {
        await clientsApi.delete(id);
        setClients(prev => prev.filter(c => c.id !== id));
      } catch (error) {
        console.error('Failed to delete client:', error);
      }
    }
  };

  if (loading) {
    return (
      <div className="loading-state" style={{ minHeight: '300px' }}>
        <div className="loading-spinner" />
        <div>Fetching clients...</div>
      </div>
    );
  }

  const getClientIcon = (platform: string = '') => {
    const plat = (platform || '').toLowerCase();
    if (plat.includes('win') || plat.includes('microsoft')) return <Cpu size={18} />;
    return <Server size={18} />;
  };

  // Convert "win32 10.0.19045" or "Windows 10 (10.0.19045)" → friendly badge.
  const formatOsLabel = (os: string = ''): string => {
    const o = (os || '').toLowerCase();
    if (o.includes('windows 11')) return 'Windows 11';
    if (o.includes('windows 10')) return 'Windows 10';
    if (o.includes('windows 8.1')) return 'Windows 8.1';
    if (o.includes('windows 8'))  return 'Windows 8';
    if (o.includes('windows 7'))  return 'Windows 7';
    if (o.includes('windows vista')) return 'Windows Vista';
    // Fallback: keep whatever the agent sent
    return os || 'Unknown OS';
  };

  // Detect link-local IPv6 / IPv4-mapped / loopback — anything useless for LAN.
  const isUnroutableAddress = (ip: string = ''): boolean => {
    if (!ip) return true;
    const l = (ip || '').toLowerCase().trim();
    if (l === '::1' || l.startsWith('fe80:') || l.startsWith('fec0:') ||
        l.startsWith('::ffff:127.') || l === '127.0.0.1') return true;
    return false;
  };

  // Return a copy of the client with ip_address normalised to a routable IPv4.
  // Priority: explicit column → metadata.ip → first private IPv4 in metadata.interfaces.
  const normaliseClient = (c: any) => {
    if (!c) return c;
    const md = c.metadata || {};
    const interfaces: any[] = Array.isArray(md.interfaces) ? md.interfaces : [];

    if (!isUnroutableAddress(c.ip_address) && c.ip_address) {
      return { ...c, _ip_quality: 'ok' };
    }

    // Try metadata.interfaces
    const isPrivateIPv4 = (a: string) =>
      /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(a);
    const candidate =
      interfaces.find((i: any) => i.address && isPrivateIPv4(i.address) && i.family === 'IPv4') ||
      interfaces.find((i: any) => i.address && i.family === 'IPv4' && !/^fe80:/i.test(i.address)) ||
      null;

    if (candidate) {
      return { ...c, ip_address: candidate.address, _ip_quality: 'recovered' };
    }
    return c;
  };

  // Calculate dynamic stats (use normalised list so "online" reflects what's
  // actually shown on screen, not whatever the database row originally had).
  const normalisedClients = clients.map(normaliseClient);
  const totalClients = normalisedClients.length;
  const onlineClients = normalisedClients.filter(c => c.is_online).length;
  const offlineClients = totalClients - onlineClients;
  
  // Total printers across all nodes
  const totalPrintersCount = normalisedClients.reduce((acc, c) => {
    const list = c.metadata?.printers || [];
    return acc + list.length;
  }, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-cyan)',
          }}>
            <Monitor size={20} />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '22px',
              color: 'var(--text-primary)',
              letterSpacing: '1px',
              margin: 0,
            }}>
              ACTIVE CLIENT NODES
            </h1>
            <p style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: '12px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              margin: 0,
            }}>
              Monitor connected Windows spooler agents and bridge links
            </p>
          </div>
        </div>

        <button onClick={fetchClients} className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {/* ── Stat Cards Row ──────────────────────────────────────────────── */}
      <div className="stat-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        {/* Total Nodes */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Server className="stat-icon" style={{ color: 'var(--accent-cyan)' }} />
            <span className="stat-badge cyan">Total</span>
          </div>
          <div className="stat-value">{totalClients}</div>
          <div className="stat-label">Registered Nodes</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: '100%', background: 'var(--accent-cyan)' }} />
          </div>
        </div>

        {/* Online Nodes */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Wifi className="stat-icon" style={{ color: 'var(--accent-green)' }} />
            <span className="stat-badge green">Online</span>
          </div>
          <div className="stat-value" style={{ textShadow: '0 0 20px rgba(0, 255, 136, 0.3)', color: 'var(--accent-green)' }}>
            {onlineClients}
          </div>
          <div className="stat-label">Active Connections</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ 
              width: `${totalClients > 0 ? (onlineClients / totalClients) * 100 : 0}%`,
              background: 'var(--accent-green)'
            }} />
          </div>
        </div>

        {/* Offline Nodes */}
        <div className="stat-card">
          <div className="stat-card-header">
            <WifiOff className="stat-icon" style={{ color: 'var(--accent-red)' }} />
            <span className="stat-badge" style={{ background: 'rgba(255, 61, 90, 0.15)', border: '1px solid rgba(255, 61, 90, 0.4)', color: '#ff3d5a' }}>Offline</span>
          </div>
          <div className="stat-value" style={{ textShadow: '0 0 20px rgba(255, 61, 90, 0.3)', color: 'var(--accent-red)' }}>
            {offlineClients}
          </div>
          <div className="stat-label">Disconnected Nodes</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ 
              width: `${totalClients > 0 ? (offlineClients / totalClients) * 100 : 0}%`,
              background: 'var(--accent-red)'
            }} />
          </div>
        </div>

        {/* Total Printers */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Monitor className="stat-icon" style={{ color: 'var(--accent-amber)' }} />
            <span className="stat-badge" style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.4)', color: '#f59e0b' }}>Printers</span>
          </div>
          <div className="stat-value" style={{ textShadow: '0 0 20px rgba(245, 158, 11, 0.3)', color: '#f59e0b' }}>
            {totalPrintersCount}
          </div>
          <div className="stat-label">Managed Printers</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: '100%', background: 'var(--accent-amber)' }} />
          </div>
        </div>
      </div>

      {/* ── Client Cards Grid ───────────────────────────────────────────── */}
      {normalisedClients.length === 0 ? (
        <div className="card text-center py-12" style={{ padding: '48px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'rgba(100, 116, 139, 0.1)', border: '1px dashed var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)', marginBottom: '16px'
          }}>
            <Monitor size={32} />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 700, fontFamily: "'Rajdhani', sans-serif", color: 'var(--text-primary)', marginBottom: '8px' }}>
            NO ACTIVE CLIENTS
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', maxWidth: '380px', margin: '0 0 24px 0', lineHeight: 1.5 }}>
            There are no Windows node agents connected. Setup the PrintServer Client Agent on target host machines.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
          {normalisedClients.map((client) => {
            const printers = client.metadata?.printers || [];
            return (
              <div key={client.id} className="card" style={{ display: 'flex', flexDirection: 'column', padding: '20px', minHeight: '320px', justifyContent: 'space-between' }}>
                
                {/* Client Header Info */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '42px', height: '42px', borderRadius: '8px',
                        background: client.is_online ? 'rgba(0, 255, 136, 0.1)' : 'var(--bg-secondary)',
                        border: `1px solid ${client.is_online ? 'rgba(0, 255, 136, 0.25)' : 'var(--border)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: client.is_online ? 'var(--accent-green)' : 'var(--text-muted)',
                      }}>
                        {client.is_online ? <Wifi size={20} /> : <WifiOff size={20} />}
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, fontFamily: "'Rajdhani', sans-serif", color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {client.hostname}
                        </h3>
                        <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-muted)' }}>
                          {client.ip_address || 'No Registered IP'}
                          {client._ip_quality === 'recovered' && (
                            <span style={{ marginLeft: '6px', color: 'var(--accent-amber)', fontSize: '9px' }} title="Recovered from metadata.interfaces (column was link-local)">
                              (recovered)
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                    
                    <span style={{
                      fontFamily: "'Share Tech Mono', monospace",
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: client.is_online ? 'rgba(0, 255, 136, 0.12)' : 'var(--bg-secondary)',
                      color: client.is_online ? 'var(--accent-green)' : 'var(--text-muted)',
                      border: `1px solid ${client.is_online ? 'rgba(0, 255, 136, 0.3)' : 'var(--border)'}`,
                    }}>
                      {client.is_online ? 'ONLINE' : 'OFFLINE'}
                    </span>
                  </div>

                  {/* System Parameters Table */}
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: '8px',
                    background: 'rgba(0, 0, 0, 0.15)', padding: '12px',
                    borderRadius: '8px', border: '1px solid var(--border)',
                    marginBottom: '16px'
                  }}>
                    {/* IP Address — dedicated row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>IP Address</span>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", color: isUnroutableAddress(client.ip_address) ? 'var(--accent-red)' : 'var(--accent-cyan)' }}>
                        {isUnroutableAddress(client.ip_address)
                          ? (client.ip_address || '— link-local only')
                          : client.ip_address}
                      </span>
                    </div>
                    {/* OS Version — friendly name */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Operating System</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
                        {getClientIcon(client.os_version)}
                        {formatOsLabel(client.os_version)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Agent Version</span>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--accent-cyan)' }}>
                        v{client.client_version || '1.0.0'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>MAC Address</span>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-primary)' }}>
                        {client.mac_address || 'N/A'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Last Pulse</span>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {client.last_seen ? format(new Date(client.last_seen), 'MM/dd HH:mm') : 'Never'}
                      </span>
                    </div>
                  </div>

                  {/* Client Managed Printers Tag-list */}
                  {printers.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <span style={{ fontSize: '12px', fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Hosted Printers ({printers.length})
                      </span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {printers.slice(0, 8).map((printer: any, idx: number) => (
                          <span key={idx} style={{
                            fontSize: '10px',
                            fontFamily: "'Share Tech Mono', monospace",
                            padding: '3px 8px',
                            background: 'rgba(0, 212, 255, 0.08)',
                            color: 'var(--accent-cyan)',
                            border: '1px solid rgba(0, 212, 255, 0.25)',
                            borderRadius: '4px',
                          }}>
                            {typeof printer === 'string' ? printer : printer?.name || 'Unknown'}
                          </span>
                        ))}
                        {printers.length > 8 && (
                          <span style={{
                            fontSize: '10px',
                            fontFamily: "'Share Tech Mono', monospace",
                            padding: '3px 8px',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-muted)',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                          }}>
                            +{printers.length - 8} MORE
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Card footer actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '12px', marginTop: '12px', borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => handleDelete(client.id)}
                    style={{
                      padding: '8px 12px',
                      background: 'rgba(255, 61, 90, 0.08)',
                      border: '1px solid rgba(255, 61, 90, 0.25)',
                      borderRadius: '6px',
                      color: 'var(--accent-red)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontFamily: "'Rajdhani', sans-serif",
                      fontSize: '12px',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 61, 90, 0.15)';
                      e.currentTarget.style.boxShadow = '0 0 10px rgba(255, 61, 90, 0.2)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255, 61, 90, 0.08)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  >
                    <Trash2 size={14} />
                    De-register
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
