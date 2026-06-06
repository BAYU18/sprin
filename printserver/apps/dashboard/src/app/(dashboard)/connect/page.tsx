'use client';

import { useEffect, useState } from 'react';
import { printers, settings } from '@/lib/api';
import {
  Server,
  Monitor,
  Smartphone,
  Printer,
  Wifi,
  Copy,
  Check,
  ExternalLink,
  QrCode,
  Apple,
  Chrome,
  Shield,
  Info,
  RefreshCw,
  Globe,
  Download,
  AlertTriangle,
  HelpCircle
} from 'lucide-react';
import { format } from 'date-fns';

interface Printer {
  id: number;
  name: string;
  uri: string;
  status: string;
  capabilities?: {
    color: boolean;
    duplex: boolean;
    paperSizes: string[];
  };
}

interface ServerInfo {
  name: string;
  ip: string;
  port: number;
}

const deviceInstructions = [
  {
    platform: 'Windows',
    icon: Monitor,
    color: 'var(--accent-cyan)',
    instructions: [
      'Buka Settings → Printers & scanners',
      'Klik "Add a printer"',
      'Pilih "Add a printer using TCP/IP address"',
      'Masukkan IP server dan klik Next',
      'Ikuti wizard untuk menyelesaikan setup'
    ],
    tip: 'Instal driver printer jika diperlukan'
  },
  {
    platform: 'Mac',
    icon: Apple,
    color: 'var(--text-muted)',
    instructions: [
      'Buka System Settings → Printers & Scanners',
      'Klik tombol + untuk menambah printer',
      'Pilih tab "IP"',
      'Masukkan alamat IP server print',
      'Pilih driver yang sesuai dan klik Add'
    ],
    tip: 'Gunakan driver PostScript atau AirPrint'
  },
  {
    platform: 'iPhone/iPad',
    icon: Smartphone,
    color: 'var(--text-muted)',
    instructions: [
      'AirPrint otomatis mendeteksi printer',
      'Tidak perlu setup manual',
      'Pastikan iOS device terhubung ke jaringan yang sama',
      'Buka aplikasi apapun → Print → Pilih printer'
    ],
    tip: 'AirPrint menemukan printer secara otomatis'
  },
  {
    platform: 'Android',
    icon: Globe,
    color: 'var(--accent-green)',
    instructions: [
      "Download aplikasi Let\`s Print Droid atau CUPS Printing dari Play Store",
      'Buka aplikasi dan pilih menu "Add Printer" (Tambah Printer)',
      'Pilih protokol "IPP" atau "IPPS" (Internet Printing)',
      'Masukkan IPP URL Printer Anda (lihat daftar di bawah) dan simpan',
      'Buka dokumen/foto di HP, klik Print bawaan Android, printer akan muncul otomatis!'
    ],
    tip: 'Gunakan protokol HTTPS (IPPS) jika mengakses dari luar jaringan / Cloudflare'
  },
  {
    platform: 'Chromebook',
    icon: Chrome,
    color: 'var(--accent-red)',
    instructions: [
      'Tekan Ctrl+P untuk membuka dialog print',
      'Pilih printer dari dropdown',
      'Atur parameter print sesuai kebutuhan',
      'Klik Print untuk memulai'
    ],
    tip: 'Chromebook mendukung IPP printer langsung'
  }
];

const tabMapping: Record<string, string> = {
  'Windows': 'Windows',
  'Mac': 'Mac',
  'iOS': 'iPhone/iPad',
  'Android': 'Android',
  'ChromeOS': 'Chromebook'
};

export default function ConnectPage() {
  const [serverInfo, setServerInfo] = useState<ServerInfo>({
    name: 'PrintServer Pro',
    ip: '127.0.0.1',
    port: 631
  });
  const [printersList, setPrintersList] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(true);
  const [activePlatform, setActivePlatform] = useState('Windows');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dynamic Agent States
  const [agentVersion, setAgentVersion] = useState('1.2.0');
  const [agentSize, setAgentSize] = useState('~42 MB');
  const [agentBuildTime, setAgentBuildTime] = useState<string | null>(null);

  // Hover states for inline styles
  const [hoveredEl, setHoveredEl] = useState<string | null>(null);

  const fetchServerInfo = async () => {
    try {
      const response = await settings.serverInfo();
      if (response?.data) {
        setServerInfo(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch server info:', error);
    }
  };

  const fetchPrinters = async () => {
    try {
      const response = await printers.list();
      setPrintersList(response.data || []);
    } catch (error) {
      console.error('Failed to fetch printers:', error);
      setPrintersList([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgentInfo = async () => {
    try {
      const response = await fetch('/downloads/agent/info');
      if (response.ok) {
        const data = await response.json();
        if (data.version) setAgentVersion(data.version);
        if (data.size) {
          const mb = (data.size / (1024 * 1024)).toFixed(1);
          setAgentSize(`${mb} MB`);
        }
        if (data.buildTime) {
          setAgentBuildTime(data.buildTime);
        }
      }
    } catch (error) {
      console.error('Failed to fetch agent info:', error);
    }
  };

  useEffect(() => {
    fetchServerInfo();
    fetchPrinters();
    fetchAgentInfo();
    const interval = setInterval(fetchPrinters, 15000);
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

  const getServerUrl = () => {
    return `ipp://${serverInfo.ip}:${serverInfo.port}/printers`;
  };

  const getSetupUrl = () => {
    return `http://${serverInfo.ip}:${serverInfo.port}/setup`;
  };

  const generateQRDataUrl = () => {
    const qrUrl = getSetupUrl();
    const qrSize = 200;
    return `https://api.qrserver.com/v1/create-qr-code/?size=${qrSize}x${qrSize}&data=${encodeURIComponent(qrUrl)}&format=svg`;
  };

  const getIppUrl = (printer: Printer) => {
    return `ipp://${serverInfo.ip}:${serverInfo.port}/printers/${printer.name.toLowerCase().replace(/\s+/g, '-')}`;
  };

  const formatBuildTime = (timeStr: string | null) => {
    if (!timeStr) return '';
    try {
      return format(new Date(timeStr), 'dd MMM yyyy HH:mm');
    } catch (e) {
      return timeStr;
    }
  };

  const currentDevice = deviceInstructions.find(d => d.platform === tabMapping[activePlatform]) || deviceInstructions[0];

  const getStatusBadgeStyle = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'idle' || s === 'ready' || s === 'online') {
      return {
        background: 'rgba(0, 255, 136, 0.1)',
        color: 'var(--accent-green)',
        border: '1px solid rgba(0, 255, 136, 0.3)',
      };
    } else if (s === 'processing' || s === 'busy') {
      return {
        background: 'rgba(245, 158, 11, 0.1)',
        color: 'var(--accent-amber)',
        border: '1px solid rgba(245, 158, 11, 0.3)',
      };
    } else {
      return {
        background: 'rgba(255, 61, 90, 0.1)',
        color: 'var(--accent-red)',
        border: '1px solid rgba(255, 61, 90, 0.3)',
      };
    }
  };

  const filteredPrinters = printersList.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '1px' }}>
            How to Connect
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Panduan koneksi printer ke PrintServer Pro
          </p>
        </div>
        <button
          onClick={fetchPrinters}
          className="btn-primary"
          disabled={loading}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}
        >
          <RefreshCw
            style={{
              width: '16px',
              height: '16px',
              animation: loading ? 'spin 1s linear infinite' : 'none'
            }}
          />
          <span style={{ fontFamily: "'Rajdhani', sans-serif", fontWeight: '600' }}>Refresh</span>
        </button>
      </div>

      {/* Top Grid: Server Info & QR Code */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        
        {/* Server Information Card */}
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.2)', borderRadius: '8px', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Server style={{ width: '24px', height: '24px' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                Server Information
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Informasi server untuk koneksi manual
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            
            {/* Server Name */}
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Server Name</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {serverInfo.name}
                </span>
                <button
                  onClick={() => copyToClipboard(serverInfo.name, 'name')}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: copiedField === 'name' ? 'var(--accent-green)' : 'var(--text-muted)' }}
                  title="Copy Server Name"
                >
                  {copiedField === 'name' ? <Check style={{ width: '16px', height: '16px' }} /> : <Copy style={{ width: '16px', height: '16px' }} />}
                </button>
              </div>
            </div>

            {/* Server IP */}
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>IP Address</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Share Tech Mono', monospace" }}>
                  {serverInfo.ip}
                </span>
                <button
                  onClick={() => copyToClipboard(serverInfo.ip, 'ip')}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: copiedField === 'ip' ? 'var(--accent-green)' : 'var(--text-muted)' }}
                  title="Copy IP Address"
                >
                  {copiedField === 'ip' ? <Check style={{ width: '16px', height: '16px' }} /> : <Copy style={{ width: '16px', height: '16px' }} />}
                </button>
              </div>
            </div>

            {/* Server Port */}
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Port</span>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Share Tech Mono', monospace" }}>
                  {serverInfo.port}
                </span>
                <button
                  onClick={() => copyToClipboard(serverInfo.port.toString(), 'port')}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: copiedField === 'port' ? 'var(--accent-green)' : 'var(--text-muted)' }}
                  title="Copy Port"
                >
                  {copiedField === 'port' ? <Check style={{ width: '16px', height: '16px' }} /> : <Copy style={{ width: '16px', height: '16px' }} />}
                </button>
              </div>
            </div>

            {/* Protocol */}
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Protocol</span>
              <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>
                IPP (Internet Printing)
              </span>
            </div>

          </div>

          {/* Master IPP URL Row */}
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: '600' }}>Master IPP URL Server</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <code style={{ background: 'var(--bg-primary)', padding: '10px 12px', borderRadius: '6px', fontSize: '13px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--accent-cyan)', border: '1px solid var(--border)', wordBreak: 'break-all', flex: 1 }}>
                {getServerUrl()}
              </code>
              <button
                onClick={() => copyToClipboard(getServerUrl(), 'url')}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: copiedField === 'url' ? 'var(--accent-green)' : 'var(--accent-cyan)', transition: 'background-color 0.2s', backgroundColor: hoveredEl === 'copy-url' ? 'rgba(0, 212, 255, 0.1)' : 'transparent' }}
                onMouseEnter={() => setHoveredEl('copy-url')}
                onMouseLeave={() => setHoveredEl(null)}
                title="Copy Master IPP URL"
              >
                {copiedField === 'url' ? <Check style={{ width: '18px', height: '18px' }} /> : <Copy style={{ width: '18px', height: '18px' }} />}
              </button>
            </div>
          </div>
        </div>

        {/* QR Code & Mobile Connection Card */}
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ padding: '10px', background: 'rgba(0, 255, 136, 0.1)', border: '1px solid rgba(0, 255, 136, 0.2)', borderRadius: '8px', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <QrCode style={{ width: '24px', height: '24px' }} />
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                  Scan QR Code
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Pindai untuk setup mobile otomatis
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowQR(!showQR)}
              style={{ background: 'transparent', border: 'none', color: 'var(--accent-cyan)', fontSize: '13px', cursor: 'pointer', fontWeight: '600', fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase' }}
            >
              {showQR ? 'Sembunyikan' : 'Tampilkan'}
            </button>
          </div>

          {showQR && (
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '20px', alignItems: 'center', justifyContent: 'center' }}>
              
              {/* QR Image Wrapper */}
              <div style={{ background: '#ffffff', padding: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--border)', boxShadow: 'var(--glow-cyan)' }}>
                <img
                  src={generateQRDataUrl()}
                  alt="Setup QR Code"
                  style={{ width: '144px', height: '144px', display: 'block' }}
                />
              </div>

              {/* Instructions and Setup Link */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, minWidth: '200px' }}>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: 0, margin: 0, listStyleType: 'none', fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.4' }}>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>✓</span>
                    <span>Hubungkan perangkat ke Wi-Fi yang sama dengan server.</span>
                  </li>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>✓</span>
                    <span>Pindai kode QR menggunakan kamera HP atau tablet Anda.</span>
                  </li>
                  <li style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>✓</span>
                    <span>Ikuti petunjuk konfigurasi profil printer otomatis.</span>
                  </li>
                </ul>

                <a
                  href={getSetupUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                  style={{
                    alignSelf: 'flex-start',
                    fontSize: '12px',
                    padding: '8px 14px',
                    marginTop: '4px',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <ExternalLink style={{ width: '14px', height: '14px' }} />
                  <span>Buka Setup Page</span>
                </a>
              </div>

            </div>
          )}
        </div>

      </div>

      {/* Middle Grid: Device Instructions & Available Printers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
        
        {/* Device Instructions Card */}
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '10px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', color: 'var(--accent-amber)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wifi style={{ width: '24px', height: '24px' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                Connect per Device
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Panduan koneksi spesifik untuk tipe perangkat Anda
              </p>
            </div>
          </div>

          {/* Cyberpunk Tabs Bar */}
          <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', borderBottom: '1px solid var(--border)', paddingBottom: '8px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
            {['Windows', 'Mac', 'iOS', 'Android', 'ChromeOS'].map((plat) => {
              const isActive = activePlatform === plat;
              const platInfo = deviceInstructions.find(d => d.platform === tabMapping[plat]) || deviceInstructions[0];
              const IconComp = platInfo.icon;
              return (
                <button
                  key={plat}
                  onClick={() => setActivePlatform(plat)}
                  style={{
                    padding: '8px 14px',
                    background: isActive ? 'rgba(0, 212, 255, 0.08)' : 'transparent',
                    border: '1px solid',
                    borderColor: isActive ? 'var(--accent-cyan)' : 'transparent',
                    borderRadius: '6px',
                    color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    fontFamily: "'Rajdhani', sans-serif",
                    fontWeight: '600',
                    fontSize: '13px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease',
                    boxShadow: isActive ? 'var(--glow-cyan)' : 'none',
                    textShadow: isActive ? '0 0 8px rgba(0, 212, 255, 0.4)' : 'none',
                  }}
                >
                  <IconComp style={{ width: '14px', height: '14px' }} />
                  <span>{plat}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Content Instructions */}
          <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-cyan)', boxShadow: 'var(--glow-cyan)' }} />
              <span style={{ fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif", letterSpacing: '0.5px' }}>
                Setup Langkah demi Langkah ({activePlatform})
              </span>
            </div>

            <ol style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: 0, margin: 0, listStyleType: 'none' }}>
              {currentDevice.instructions.map((step, idx) => (
                <li key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '50%', background: 'rgba(0, 212, 255, 0.08)', border: '1px solid rgba(0, 212, 255, 0.3)', color: 'var(--accent-cyan)', fontFamily: "'Share Tech Mono', monospace", fontWeight: 'bold', fontSize: '11px', flexShrink: 0 }}>
                    {idx + 1}
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
                    {step}
                  </span>
                </li>
              ))}
            </ol>

            {activePlatform === 'Android' && (
              <div style={{
                marginTop: '12px',
                padding: '12px 16px',
                background: 'rgba(0, 255, 136, 0.05)',
                border: '1px solid rgba(0, 255, 136, 0.2)',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--accent-green)' }}>Dapatkan Aplikasi APK Android Resmi:</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Mencetak langsung via HP dari mana saja tanpa ribet setup.</span>
                </div>
                <a
                  href="/downloads/android-apk"
                  download="PrintServer-Mobile.apk"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    background: 'var(--accent-green)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '6px',
                    fontFamily: "'Rajdhani', sans-serif",
                    fontWeight: 'bold',
                    fontSize: '12px',
                    textDecoration: 'none',
                    cursor: 'pointer',
                    boxShadow: 'var(--glow-green)'
                  }}
                >
                  <Download style={{ width: '14px', height: '14px' }} />
                  Download Mobile APK
                </a>
              </div>
            )}

            {/* Tip Box */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', background: 'rgba(245, 158, 11, 0.05)', border: '1px dashed rgba(245, 158, 11, 0.3)', borderRadius: '6px', color: 'var(--accent-amber)', fontSize: '12px', marginTop: '4px' }}>
              <Info style={{ width: '14px', height: '14px', flexShrink: 0 }} />
              <span><strong>Tips:</strong> {currentDevice.tip}</span>
            </div>
          </div>
        </div>

        {/* Available Printers Card */}
        <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ padding: '10px', background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.2)', borderRadius: '8px', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Printer style={{ width: '24px', height: '24px' }} />
              </div>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                  Available Printers
                </h2>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  Pilih printer dan copy IPP URL tujuan
                </p>
              </div>
            </div>
          </div>

          {/* Search bar inside Card */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="text"
              placeholder="Cari nama printer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input"
              style={{ flex: 1, padding: '8px 12px', fontSize: '13px' }}
            />
          </div>

          {/* Printer List / Grid */}
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '12px' }}>
              <RefreshCw style={{ width: '24px', height: '24px', color: 'var(--accent-cyan)', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: "'Share Tech Mono', monospace" }}>Loading printer catalog...</span>
            </div>
          ) : filteredPrinters.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '12px', border: '1px dashed var(--border)', borderRadius: '8px' }}>
              <Printer style={{ width: '36px', height: '36px', color: 'var(--text-dim)' }} />
              <span style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center' }}>
                {searchQuery ? 'Printer tidak ditemukan.' : 'Belum ada printer yang terdaftar.'}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
              {filteredPrinters.map((printer) => {
                const ippUrl = getIppUrl(printer);
                const isCopied = copiedField === `printer-${printer.id}`;
                return (
                  <div
                    key={printer.id}
                    style={{
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
                        {printer.name}
                      </span>
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: '600',
                        fontFamily: "'Share Tech Mono', monospace",
                        ...getStatusBadgeStyle(printer.status)
                      }}>
                        {printer.status}
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-primary)', padding: '6px 10px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      <code style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {ippUrl}
                      </code>
                      <button
                        onClick={() => copyToClipboard(ippUrl, `printer-${printer.id}`)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: isCopied ? 'var(--accent-green)' : 'var(--text-muted)',
                        }}
                        title="Copy Printer IPP URL"
                      >
                        {isCopied ? <Check style={{ width: '14px', height: '14px' }} /> : <Copy style={{ width: '14px', height: '14px' }} />}
                      </button>
                    </div>

                    {printer.capabilities && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {printer.capabilities.color && (
                          <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(0, 212, 255, 0.1)', color: 'var(--accent-cyan)', border: '1px solid rgba(0, 212, 255, 0.2)' }}>Color</span>
                        )}
                        {printer.capabilities.duplex && (
                          <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(139, 92, 246, 0.1)', color: '#a78bfa', border: '1px solid rgba(139, 92, 246, 0.2)' }}>Duplex</span>
                        )}
                        {printer.capabilities.paperSizes?.slice(0, 3).map((sz) => (
                          <span key={sz} style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(74, 96, 128, 0.15)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>{sz}</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>

      {/* Windows Node Agent Section */}
      <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ padding: '10px', background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.2)', borderRadius: '8px', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Monitor style={{ width: '24px', height: '24px' }} />
          </div>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
              Windows Node Agent
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Download client agent untuk sinkronisasi printer lokal Windows
            </p>
          </div>
        </div>

        {/* Dynamic Binary Card Box */}
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
              PrintServer Client Agent (.exe)
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Aplikasi WebSocket routing IPP background service untuk Windows 64-bit.
            </span>
            
            {/* Version and Build details */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--accent-cyan)', background: 'rgba(0, 212, 255, 0.08)', border: '1px solid rgba(0, 212, 255, 0.2)', padding: '2px 8px', borderRadius: '4px' }}>
                Versi: {agentVersion}
              </span>
              <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-muted)', background: 'rgba(74, 96, 128, 0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                Ukuran: {agentSize}
              </span>
              {agentBuildTime && (
                <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-muted)' }}>
                  Build: {formatBuildTime(agentBuildTime)}
                </span>
              )}
            </div>
          </div>

          {/* Cyber Primary Download Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '220px' }}>
            <a
              href="/downloads/agent"
              download={`PrintServer-Agent-${agentVersion}.exe`}
              style={hoveredEl === 'dl-exe' ? { ...cyberBtnStyle, ...cyberBtnHoverStyle } : cyberBtnStyle}
              onMouseEnter={() => setHoveredEl('dl-exe')}
              onMouseLeave={() => setHoveredEl(null)}
            >
              <Download style={{ width: '16px', height: '16px' }} />
              <span>Download Agent (.exe)</span>
            </a>
            
            <a
              href="/downloads/add-printers.ps1"
              download="add-all-printers.ps1"
              style={hoveredEl === 'dl-ps1' ? { ...bulkBtnStyle, ...bulkBtnHoverStyle } : bulkBtnStyle}
              onMouseEnter={() => setHoveredEl('dl-ps1')}
              onMouseLeave={() => setHoveredEl(null)}
              title="PowerShell script untuk add semua printer dari server secara bulk"
            >
              <ExternalLink style={{ width: '12px', height: '12px' }} />
              <span>Bulk Add Printers (.ps1)</span>
            </a>
          </div>
        </div>

        {/* Info Installation Guide */}
        <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: '8px', padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <Info style={{ width: '20px', height: '20px', color: 'var(--accent-amber)', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-amber)', fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Petunjuk Instalasi PC Windows:
            </span>
            <ol style={{ padding: 0, margin: '6px 0 0 0', listStyleType: 'none', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'rgba(255, 255, 255, 0.75)', lineHeight: '1.4' }}>
              <li>1. Unduh berkas installer <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: '3px', color: 'var(--accent-cyan)' }}>.exe</code> di atas.</li>
              <li>2. Jalankan installer dengan klik kanan dan pilih <strong>Run as Administrator</strong>.</li>
              <li>3. Saat diminta, masukkan URL Server: <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: '3px', color: 'var(--accent-cyan)' }}>http://{serverInfo.ip}:{serverInfo.port}</code></li>
              <li>4. Masukkan Node Secret (dapat ditemukan di halaman Settings).</li>
              <li>5. Klik tombol <strong>Connect</strong> — Agent akan terdaftar dan aktif di dashboard Anda.</li>
            </ol>
          </div>
        </div>

        {/* Footer Technical Indicators */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px', color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-green)', boxShadow: 'var(--glow-green)' }} />
            <span>Windows 10/11 (64-bit)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-green)', boxShadow: 'var(--glow-green)' }} />
            <span>Node.js Embedded Runtime</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-green)', boxShadow: 'var(--glow-green)' }} />
            <span>Hak Akses Administrator diperlukan</span>
          </div>
        </div>

      </div>

      {/* Android Mobile App Section */}
      <div className="card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ padding: '10px', background: 'rgba(0, 255, 136, 0.1)', border: '1px solid rgba(0, 255, 136, 0.2)', borderRadius: '8px', color: 'var(--accent-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Smartphone style={{ width: '24px', height: '24px' }} />
          </div>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
              Android Mobile App
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Download aplikasi mobile untuk mencetak langsung dari ponsel Android Anda
            </p>
          </div>
        </div>

        {/* Dynamic Binary Card Box */}
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, minWidth: '280px' }}>
            <span style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)' }}>
              PrintServer Mobile (.apk) / PWA App
            </span>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Aplikasi mobile Android ringan untuk upload file cetak dan management printer secara langsung.
            </span>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--accent-green)', background: 'rgba(0, 255, 136, 0.08)', border: '1px solid rgba(0, 255, 136, 0.2)', padding: '2px 8px', borderRadius: '4px' }}>
                Format: APK & PWA
              </span>
              <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-muted)', background: 'rgba(74, 96, 128, 0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                Ukuran: ~2.5 MB
              </span>
              <span style={{ fontSize: '11px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-muted)', background: 'rgba(74, 96, 128, 0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                Android 8.0+
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '220px' }}>
            <a
              href="/downloads/android-apk"
              download="PrintServer-Mobile.apk"
              style={hoveredEl === 'dl-apk' ? { ...cyberBtnStyle, ...cyberBtnHoverStyle, borderColor: 'var(--accent-green)', color: 'var(--accent-green)' } : { ...cyberBtnStyle, borderColor: 'rgba(0, 255, 136, 0.3)', color: 'rgba(0, 255, 136, 0.9)' }}
              onMouseEnter={() => setHoveredEl('dl-apk')}
              onMouseLeave={() => setHoveredEl(null)}
            >
              <Download style={{ width: '16px', height: '16px' }} />
              <span>Download App (.apk)</span>
            </a>
          </div>
        </div>

        {/* Info Installation Guide */}
        <div style={{ background: 'rgba(0, 255, 136, 0.05)', border: '1px solid rgba(0, 255, 136, 0.2)', borderRadius: '8px', padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <Info style={{ width: '20px', height: '20px', color: 'var(--accent-green)', flexShrink: 0, marginTop: '2px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--accent-green)', fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Dua Cara Instalasi di Android:
            </span>
            <div style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.75)', lineHeight: '1.5', display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
              <div>
                <strong>Metode 1: Download & Install APK (Rekomendasi)</strong>
                <ol style={{ paddingLeft: '16px', margin: '4px 0 0 0', listStyleType: 'none' }}>
                  <li>1. Unduh berkas <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: '3px', color: 'var(--accent-green)' }}>.apk</code> di atas.</li>
                  <li>2. Buka berkas unduhan di HP dan klik <strong>Install</strong> (Izinkan instalasi dari sumber tidak dikenal jika diminta).</li>
                  <li>3. Buka aplikasi, masukkan URL Server: <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: '3px', color: 'var(--accent-green)' }}>http://{serverInfo.ip}:{serverInfo.port}</code> untuk mulai mencetak.</li>
                </ol>
              </div>
              <div>
                <strong>Metode 2: Menggunakan PWA (Tanpa Unduhan File)</strong>
                <ol style={{ paddingLeft: '16px', margin: '4px 0 0 0', listStyleType: 'none' }}>
                  <li>1. Buka browser Chrome di Android, akses URL Server: <code style={{ background: 'var(--bg-primary)', padding: '1px 4px', borderRadius: '3px', color: 'var(--accent-green)' }}>http://{serverInfo.ip}:{serverInfo.port}</code></li>
                  <li>2. Klik menu titik tiga Chrome di kanan atas, lalu pilih <strong>"Add to Home screen"</strong> (Tambahkan ke Layar Utama).</li>
                  <li>3. Aplikasi web PrintServer akan langsung terpasang di menu HP Android Anda.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Cyber Documentation Help Card */}
      <div style={{
        background: 'linear-gradient(90deg, rgba(0, 212, 255, 0.04) 0%, rgba(139, 92, 246, 0.04) 100%)',
        border: '1px solid rgba(0, 212, 255, 0.2)',
        borderRadius: '12px',
        padding: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: '280px' }}>
          <div style={{ padding: '12px', background: 'rgba(0, 212, 255, 0.1)', borderRadius: '50%', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HelpCircle style={{ width: '28px', height: '28px' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif" }}>
              Butuh Bantuan Lebih Lanjut?
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
              Untuk informasi lebih detail mengenai setup agent, pemecahan masalah (troubleshooting), dan panduan lengkap silakan pelajari dokumentasi resmi kami.
            </p>
          </div>
        </div>
        <a
          href={`http://${serverInfo.ip}:${serverInfo.port}/help`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary"
          style={{
            fontSize: '13px',
            padding: '10px 18px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <ExternalLink style={{ width: '16px', height: '16px' }} />
          <span>Documentation</span>
        </a>
      </div>

    </div>
  );
}

// Inline Styles for complex states
const cyberBtnStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.12) 0%, rgba(0, 255, 136, 0.12) 100%)',
  border: '1px solid var(--accent-cyan)',
  boxShadow: 'var(--glow-cyan)',
  color: '#ffffff',
  padding: '12px 20px',
  borderRadius: '8px',
  fontFamily: "'Share Tech Mono', monospace",
  fontWeight: 'bold',
  fontSize: '13px',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  transition: 'all 0.3s ease',
  textDecoration: 'none',
};

const cyberBtnHoverStyle: React.CSSProperties = {
  background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.25) 0%, rgba(0, 255, 136, 0.25) 100%)',
  boxShadow: '0 0 15px rgba(0, 212, 255, 0.6)',
  borderColor: '#ffffff',
};

const bulkBtnStyle: React.CSSProperties = {
  background: 'rgba(74, 96, 128, 0.1)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
  padding: '10px 16px',
  borderRadius: '8px',
  fontSize: '12px',
  fontFamily: "'Rajdhani', sans-serif",
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  transition: 'all 0.2s',
  textDecoration: 'none',
};

const bulkBtnHoverStyle: React.CSSProperties = {
  background: 'rgba(74, 96, 128, 0.2)',
  borderColor: 'var(--accent-cyan)',
};
