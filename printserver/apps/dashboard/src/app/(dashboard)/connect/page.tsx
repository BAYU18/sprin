'use client';

import { useEffect, useState } from 'react';
import { settings } from '@/lib/api';
import {
  Bot,
  Download,
  Server,
  Monitor,
  CheckCircle2,
  XCircle,
  Clock,
  Cpu,
  HardDrive,
  Network,
  Copy,
  Check,
  RefreshCw,
  ChevronRight,
  Shield,
  Zap,
  FileText,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface AgentInfo {
  version: string;
  size: number;
  buildTime: string;
  downloadUrl: string;
}

interface Node {
  id: number;
  hostname: string;
  ip_address: string;
  os_version: string;
  node_version: string;
  is_online: boolean;
  last_heartbeat: string | null;
  printer_stats: {
    printers_online: number;
    printers_offline: number;
    jobs_in_queue: number;
    printer_count: number;
  };
  system_stats: {
    cpu_usage: number;
    memory_usage: number;
  };
 created_at: string;
}

interface NodesResponse {
  nodes: Node[];
  total: number;
  page: number;
  limit: number;
}

const installSteps = [
  {
    step: 1,
    title: 'Download Agent',
    description: 'Klik tombol Download Agent di bawah untuk mengunduh file PrintServer-Agent.exe',
    icon: Download,
    color: 'var(--accent-cyan)'
  },
  {
    step: 2,
    title: 'Jalankan Installer',
    description: 'Double-click file .exe yang sudah diunduh. Jika muncul警告, klik "Run anyway"',
    icon: Monitor,
    color: 'var(--accent-amber)'
  },
  {
    step: 3,
    title: 'Konfigurasi Server URL',
    description: 'Masukkan URL server print Anda (contoh: http://192.168.1.100:3000) dan klik Connect',
    icon: Server,
    color: 'var(--accent-green)'
  },
  {
    step: 4,
    title: 'Selesai!',
    description: 'Agent akan otomatis mendeteksi printer dan muncul di dashboard',
    icon: CheckCircle2,
    color: 'var(--accent-green)'
  }
];

export default function ConnectAgentPage() {
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [nodes, setNodes] = useState<Node[]>([]);
  const [nodesLoading, setNodesLoading] = useState(true);
  const [nodesTotal, setNodesTotal] = useState(0);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<{ name: string; ip: string; port: number }>({
    name: 'PrintServer',
    ip: 'localhost',
    port: 3000
  });

  const fetchAgentInfo = async () => {
    try {
      const response = await fetch('/api/downloads/agent/info');
      if (response.ok) {
        const data = await response.json();
        setAgentInfo(data);
      }
    } catch (error) {
      console.error('Failed to fetch agent info:', error);
    } finally {
      setAgentLoading(false);
    }
  };

  const fetchNodes = async () => {
    try {
      const response = await fetch('/api/nodes');
      if (response.ok) {
        const data: NodesResponse = await response.json();
        setNodes(data.nodes || []);
        setNodesTotal(data.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
    } finally {
      setNodesLoading(false);
    }
  };

  const fetchServerInfo = async () => {
    try {
      const response = await settings.serverInfo();
      if (response?.data) {
        setServerInfo(response.data);
        const defaultUrl = `http://${response.data.ip}:${response.data.port}`;
        setServerUrl(defaultUrl);
        setServerUrlInput(defaultUrl);
      }
    } catch (error) {
      console.error('Failed to fetch server info:', error);
    }
  };

  useEffect(() => {
    fetchAgentInfo();
    fetchNodes();
    fetchServerInfo();
    const interval = setInterval(fetchNodes, 15000);
    return () => clearInterval(interval);
  }, []);

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleSaveServerUrl = () => {
    setServerUrl(serverUrlInput);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `~${(bytes / 1024).toFixed(0)} KB`;
    }
    return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return 'Never';
    }
  };

  const getStatusBadge = (isOnline: boolean) => {
    if (isOnline) {
      return {
        background: 'rgba(0, 255, 136, 0.1)',
        color: 'var(--accent-green)',
        border: '1px solid rgba(0, 255, 136, 0.3)',
        icon: CheckCircle2,
        text: 'Online'
      };
    }
    return {
      background: 'rgba(255, 61, 90, 0.1)',
      color: 'var(--accent-red)',
      border: '1px solid rgba(255, 61, 90, 0.3)',
      icon: XCircle,
      text: 'Offline'
    };
  };

  const onlineCount = nodes.filter(n => n.is_online).length;
  const offlineCount = nodesTotal - onlineCount;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '1px' }}>
            Connect Agent
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Pasang PrintServer Agent di Windows untukauto-detect printer
</p>
        </div>
        <button
          onClick={fetchNodes}
          className="btn-primary"
          disabled={nodesLoading}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <RefreshCw style={{ width: '16px', height: '16px', animation: nodesLoading ? 'spin 1s linear infinite' : 'none' }} />
          <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: '600' }}>Refresh</span>
        </button>
      </div>

      {/* Hero Section */}
      <div className="card" style={{ 
        padding: '32px', 
        background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.08) 0%, rgba(0, 255, 136, 0.05) 100%)',
        border: '1px solid rgba(0, 212, 255, 0.2)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Animated background grid */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          pointerEvents: 'none'
        }} />
        
        <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '32px', alignItems: 'center', position: 'relative' }}>
          {/* Left: Icon & Text */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, minWidth: '280px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                padding: '16px',
                background: 'rgba(0, 212, 255, 0.15)',
                border: '1px solid rgba(0, 212, 255, 0.3)',
                borderRadius: '12px',
                color: 'var(--accent-cyan)',
                boxShadow: 'var(--glow-cyan)'
              }}>
                <Bot style={{ width: '40px', height: '40px' }} />
              </div>
              <div>
                <h2 style={{ fontSize: '22px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                  PrintServer Agent
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Windows print agent with auto-printer detection
                </p>
              </div>
            </div>
            
            <p style={{ fontSize: '14px', color: 'var(--text-primary)', lineHeight: '1.6', maxWidth: '520px' }}>
              PrintServer Agent adalah layanan background di Windows yang secara otomatis mendeteksi 
              semua printer yang terhubung ke PC dan sync ke dashboard server. Cukup install dan 
              agent akan menangani segalanya.
            </p>

            <div style={{ display: 'flex', flexDirection: 'row', gap: '24px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Zap style={{ width: '16px', height: '16px', color: 'var(--accent-amber)' }} />
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Auto-detect printer</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Shield style={{ width: '16px', height: '16px', color: 'var(--accent-green)' }} />
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Secure connection</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock style={{ width: '16px', height: '16px', color: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Real-time sync</span>
              </div>
            </div>
          </div>

          {/* Right: Download Card */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '24px',
            minWidth: '260px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <FileText style={{ width: '20px', height: '20px', color: 'var(--accent-cyan)' }} />
              <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>PrintServer-Agent.exe</span>
            </div>
            
            {agentLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
                <Loader2 style={{ width: '16px', height: '16px', animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '13px' }}>Loading...</span>
              </div>
            ) : agentInfo ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Version</span>
                    <span style={{ color: 'var(--text-primary)', fontFamily: "'Share Tech Mono', monospace" }}>{agentInfo.version}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Size</span>
                    <span style={{ color: 'var(--text-primary)', fontFamily: "'Share Tech Mono', monospace" }}>{formatBytes(agentInfo.size)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Build</span>
                    <span style={{ color: 'var(--text-primary)', fontFamily: "'Share Tech Mono', monospace" }}>
                      {agentInfo.buildTime ? format(new Date(agentInfo.buildTime), 'dd MMM yyyy') : 'N/A'}
                    </span>
                  </div>
                </div>
                
                <a
                  href="/api/downloads/agent"
                  download
                  className="btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px 20px',
                    textDecoration: 'none',
                    fontWeight: '600',
                    fontSize: '14px'
                  }}
                >
                  <Download style={{ width: '18px', height: '18px' }} />
                  Download Agent
                </a>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-red)' }}>
                <AlertCircle style={{ width: '16px', height: '16px' }} />
                <span style={{ fontSize: '13px' }}>Agent not available</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Middle Grid: Install Steps & Server URL Config */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '24px' }}>
        
        {/* Installation Steps Card */}
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.2)', borderRadius: '8px', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText style={{ width: '24px', height: '24px' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                Installation Guide
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Step-by-step Windows installation
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {installSteps.map((item, index) => {
              const IconComp = item.icon;
              const isLast = index === installSteps.length - 1;
              return (
                <div key={item.step} style={{ display: 'flex', gap: '16px', position: 'relative' }}>
                  {/* Connector line */}
                  {!isLast && (
                    <div style={{
                      position: 'absolute',
                      left: '19px',
                      top: '40px',
                      bottom: '-16px',
                      width: '2px',
                      background: 'linear-gradient(180deg, var(--border) 0%, transparent 100%)'
                    }} />
                  )}
                  
                  {/* Step number circle */}
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: `${item.color}20`,
                    border: `2px solid ${item.color}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: `0 0 12px ${item.color}40`
                  }}>
                    <IconComp style={{ width: '20px', height: '20px', color: item.color }} />
                  </div>
                  
                  {/* Content */}
                  <div style={{ flex: 1, paddingTop: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Step {item.step}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginTop: '4px' }}>
                      {item.title}
                    </h3>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.5' }}>
                      {item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Server URL Config Card */}
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', background: 'rgba(0, 255, 136, 0.1)', border: '1px solid rgba(0, 255, 136, 0.2)', borderRadius: '8px', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Network style={{ width: '24px', height: '24px' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                Server Configuration
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Configure agent server URL
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              Masukkan URL server PrintServer untuk mengkonfigurasi agent. URL ini akan digunakan 
              agent untuk terhubung ke dashboard dan mengirim heartbeat.
            </p>

            {/* Current Server URL Display */}
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>
                Current Server URL
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <code style={{ 
                  background: 'var(--bg-primary)', 
                  padding: '10px 12px', 
                  borderRadius: '6px', 
                  fontSize: '13px', 
                  fontFamily: "'Share Tech Mono', monospace", 
                  color: 'var(--accent-cyan)', 
                  border: '1px solid var(--border)', 
                  wordBreak: 'break-all', 
                  flex: 1 
                }}>
                  {serverUrl || 'Not configured'}
                </code>
                <button
                  onClick={() => serverUrl && copyToClipboard(serverUrl, 'server-url')}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    cursor: 'pointer', 
                    padding: '8px', 
                    borderRadius: '6px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    color: copiedField === 'server-url' ? 'var(--accent-green)' : 'var(--accent-cyan)',
                    transition: 'background-color 0.2s'
                  }}
                  title="Copy Server URL"
                >
                  {copiedField === 'server-url' ? <Check style={{ width: '18px', height: '18px' }} /> : <Copy style={{ width: '18px', height: '18px' }} />}
                </button>
              </div>
            </div>

            {/* Server URL Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: '600' }}>
                New Server URL
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={serverUrlInput}
                  onChange={(e) => setServerUrlInput(e.target.value)}
                  placeholder="http://192.168.1.100:3000"
                  style={{
                    flex: 1,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    fontSize: '14px',
                    fontFamily: "'Share Tech Mono', monospace",
                    color: 'var(--text-primary)',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-cyan)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
                />
                <button
                  onClick={handleSaveServerUrl}
                  className="btn-primary"
                  style={{
                    padding: '12px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Check style={{ width: '16px', height: '16px' }} />
                  Save
                </button>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Format: http://IP:PORT (contoh: http://192.168.1.100:3000)
              </span>
            </div>

            {/* Server Info Mini */}
            <div style={{ 
              background: 'var(--bg-secondary)', 
              border: '1px solid var(--border)', 
              borderRadius: '8px', 
              padding: '16px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px'
            }}>
              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Server Name</span>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginTop: '4px' }}>{serverInfo.name}</div>
              </div>
              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>IP Address</span>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Share Tech Mono', monospace", marginTop: '4px' }}>{serverInfo.ip}</div>
              </div>
              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Port</span>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Share Tech Mono', monospace", marginTop: '4px' }}>{serverInfo.port}</div>
              </div>
              <div>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Protocol</span>
                <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', marginTop: '4px' }}>IPP</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connected Agents Section */}
      <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Monitor style={{ width: '24px', height: '24px' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                Connected Agents
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {nodesTotal} agent(s) registered • {onlineCount} online • {offlineCount} offline
              </p>
            </div>
          </div>
        </div>

        {nodesLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '40px', color: 'var(--text-muted)' }}>
            <Loader2 style={{ width: '20px', height: '20px', animation: 'spin 1s linear infinite' }} />
            <span>Loading connected agents...</span>
          </div>
        ) : nodes.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <Bot style={{ width: '48px', height: '48px', opacity: 0.3 }} />
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>No Agents Connected</p>
              <p style={{ fontSize: '13px' }}>Download dan install PrintServer Agent di Windows untuk mulai</p>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {nodes.map((node) => {
              const status = getStatusBadge(node.is_online);
              const StatusIcon = status.icon;
              
              return (
                <div
                  key={node.id}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '16px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    flexWrap: 'wrap',
                    transition: 'border-color 0.2s, box-shadow 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-hover)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {/* Status Icon */}
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    background: status.background,
                    border: status.border,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <StatusIcon style={{ width: '22px', height: '22px', color: status.color }} />
</div>

                  {/* Agent Info */}
                  <div style={{ flex: 1, minWidth: '180px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {node.hostname}
                      </span>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        background: status.background,
                        color: status.color,
                        border: status.border,
                        fontFamily: "'Share Tech Mono', monospace",
                        textTransform: 'uppercase'
                      }}>
                        {status.text}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace" }}>{node.ip_address || 'N/A'}</span>
                      <span>•</span>
                      <span>{node.os_version || 'Unknown OS'}</span>
 </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Cpu style={{ width: '14px', height: '14px', color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: '12px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-primary)' }}>
                        {node.system_stats?.cpu_usage ?? 0}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <HardDrive style={{ width: '14px', height: '14px', color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: '12px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-primary)' }}>
                        {node.system_stats?.memory_usage ?? 0}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Printer style={{ width: '14px', height: '14px', color: 'var(--text-muted)' }} />
                      <span style={{ fontSize: '12px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-primary)' }}>
                        {node.printer_stats?.printers_online ?? 0}/{node.printer_stats?.printer_count ?? 0}
                      </span>
                    </div>
                  </div>

                  {/* Last Heartbeat */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Last seen</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-primary)' }}>
                      {formatTimeAgo(node.last_heartbeat)}
                    </span>
                  </div>

                  {/* Chevron */}
                  <ChevronRight style={{ width: '18px', height: '18px', color: 'var(--text-muted)', flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CSS Animation */}
      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Missing Printer icon helper
function Printer({ style }: { style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
