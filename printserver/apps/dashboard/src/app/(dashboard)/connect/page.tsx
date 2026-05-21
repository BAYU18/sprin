'use client';

import { useEffect, useState } from 'react';
import { printers } from '@/lib/api';
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
  Windows,
  Apple,
  Chrome,
  Shield,
  Info,
  RefreshCw,
  Globe
} from 'lucide-react';

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
    icon: Windows,
    color: 'bg-blue-500',
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
    color: 'bg-gray-500',
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
    color: 'bg-gray-600',
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
    color: 'bg-green-500',
    instructions: [
      'Buka Settings → Connected devices → Printing',
      'Aktifkan Cloud Print atau北方 Printing Service',
      'Pilih printer dari daftar yang tersedia',
      'Atur default printer jika perlu'
    ],
    tip: 'Beberapa Android mendukung AirPrint via plugin'
  },
  {
    platform: 'Chromebook',
    icon: Chrome,
    color: 'bg-red-500',
    instructions: [
      'Tekan Ctrl+P untuk membuka dialog print',
      'Pilih printer dari dropdown',
      'Atur parameter print sesuai kebutuhan',
      'Klik Print untuk memulai'
    ],
    tip: 'Chromebook mendukung IPP printer langsung'
  }
];

export default function ConnectPage() {
  const [serverInfo, setServerInfo] = useState<ServerInfo>({
    name: process.env.NEXT_PUBLIC_SERVER_NAME || 'PrintServer Pro',
    ip: process.env.NEXT_PUBLIC_SERVER_IP || '192.168.1.100',
    port: parseInt(process.env.NEXT_PUBLIC_SERVER_PORT || '631', 10)
  });
  const [printersList, setPrintersList] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(true);

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

  useEffect(() => {
    fetchPrinters();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">How to Connect</h1>
          <p className="text-slate-400 text-sm mt-1">Panduan koneksi printer ke PrintServer Pro</p>
        </div>
        <button
          onClick={fetchPrinters}
          className="btn-secondary flex items-center gap-2"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Server className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Server Information</h2>
                <p className="text-slate-400 text-sm">Informasi server untuk koneksi</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-700/50 rounded-lg p-4">
                <label className="text-slate-400 text-sm block mb-1">Server Name</label>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg">{serverInfo.name}</span>
                  <button
                    onClick={() => copyToClipboard(serverInfo.name, 'name')}
                    className="p-1 hover:bg-slate-600 rounded"
                  >
                    {copiedField === 'name' ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-4">
                <label className="text-slate-400 text-sm block mb-1">IP Address</label>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg">{serverInfo.ip}</span>
                  <button
                    onClick={() => copyToClipboard(serverInfo.ip, 'ip')}
                    className="p-1 hover:bg-slate-600 rounded"
                  >
                    {copiedField === 'ip' ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-4">
                <label className="text-slate-400 text-sm block mb-1">Port</label>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg">{serverInfo.port}</span>
                  <button
                    onClick={() => copyToClipboard(serverInfo.port.toString(), 'port')}
                    className="p-1 hover:bg-slate-600 rounded"
                  >
                    {copiedField === 'port' ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-slate-700/50 rounded-lg p-4">
                <label className="text-slate-400 text-sm block mb-1">Protocol</label>
                <span className="font-semibold text-lg">IPP (Internet Printing)</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <QrCode className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Scan QR Code</h2>
                  <p className="text-slate-400 text-sm">Pindai untuk setup otomatis</p>
                </div>
              </div>
              <button
                onClick={() => setShowQR(!showQR)}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                {showQR ? 'Sembunyikan' : 'Tampilkan'}
              </button>
            </div>

            {showQR && (
              <div className="flex flex-col items-center">
                <div className="bg-white p-4 rounded-xl">
                  <img
                    src={generateQRDataUrl()}
                    alt="Setup QR Code"
                    className="w-48 h-48"
                  />
                </div>
                <p className="text-slate-400 text-sm mt-3 text-center">
                  Scan kode QR ini dengan kamera perangkat Anda untuk terhubung ke server secara otomatis.
                </p>
                <a
                  href={getSetupUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 flex items-center gap-2 text-blue-400 hover:text-blue-300 text-sm"
                >
                  <ExternalLink className="w-4 h-4" />
                  Buka Setup Page
                </a>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Shield className="w-6 h-6 text-purple-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Manual Setup</h2>
                <p className="text-slate-400 text-sm">Setup manual dengan IP server</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-slate-700/50 rounded-lg p-4">
                <label className="text-slate-400 text-sm block mb-2">IPP URL Server</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-slate-800 px-3 py-2 rounded text-sm font-mono text-green-400 break-all">
                    {getServerUrl()}
                  </code>
                  <button
                    onClick={() => copyToClipboard(getServerUrl(), 'url')}
                    className="p-2 hover:bg-slate-600 rounded"
                  >
                    {copiedField === 'url' ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <Copy className="w-5 h-5 text-slate-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="w-5 h-5 text-yellow-500 mt-0.5" />
                  <div>
                    <p className="text-yellow-200 text-sm font-medium">Petunjuk:</p>
                    <p className="text-yellow-100/70 text-sm mt-1">
                      Gunakan IP address di atas untuk menghubungkan printer secara manual pada perangkat Anda.
                      Pastikan perangkat berada dalam jaringan yang sama dengan server.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <Wifi className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Connect per Device</h2>
                <p className="text-slate-400 text-sm">Panduan koneksi per jenis perangkat</p>
              </div>
            </div>

            <div className="space-y-4">
              {deviceInstructions.map((device) => {
                const IconComponent = device.icon;
                return (
                  <div
                    key={device.platform}
                    className="bg-slate-700/30 rounded-lg p-4 border border-slate-700"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`p-2 ${device.color} rounded-lg`}>
                        <IconComponent className="w-5 h-5 text-white" />
                      </div>
                      <h3 className="font-semibold">{device.platform}</h3>
                    </div>
                    <ol className="space-y-2 text-sm text-slate-300">
                      {device.instructions.map((instruction, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="flex-shrink-0 w-5 h-5 bg-slate-600 rounded-full flex items-center justify-center text-xs text-slate-300">
                            {idx + 1}
                          </span>
                          <span>{instruction}</span>
                        </li>
                      ))}
                    </ol>
                    <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                      <Info className="w-3 h-3" />
                      {device.tip}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-cyan-500/20 rounded-lg">
                <Printer className="w-6 h-6 text-cyan-500" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Available Printers</h2>
                <p className="text-slate-400 text-sm">Daftar printer yang tersedia di server</p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
              </div>
            ) : printersList.length === 0 ? (
              <div className="text-center py-8">
                <Printer className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">Belum ada printer yang terdaftar</p>
                <p className="text-slate-500 text-sm mt-1">Tambahkan printer di halaman Printers</p>
              </div>
            ) : (
              <div className="space-y-3">
                {printersList.map((printer) => (
                  <div
                    key={printer.id}
                    className="bg-slate-700/50 rounded-lg p-4 border border-slate-600 hover:border-slate-500 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          printer.status === 'idle' || printer.status === 'ready'
                            ? 'bg-green-500'
                            : printer.status === 'processing'
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                        }`} />
                        <span className="font-medium">{printer.name}</span>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded ${
                        printer.status === 'idle' || printer.status === 'ready'
                          ? 'bg-green-500/20 text-green-400'
                          : printer.status === 'processing'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {printer.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <code className="flex-1 text-xs text-slate-400 font-mono bg-slate-800 px-2 py-1 rounded break-all">
                        {getIppUrl(printer)}
                      </code>
                      <button
                        onClick={() => copyToClipboard(getIppUrl(printer), `printer-${printer.id}`)}
                        className="p-1 hover:bg-slate-600 rounded"
                      >
                        {copiedField === `printer-${printer.id}` ? (
                          <Check className="w-4 h-4 text-green-500" />
                        ) : (
                          <Copy className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                    </div>
                    {printer.capabilities && (
                      <div className="flex items-center gap-2 mt-2">
                        {printer.capabilities.color && (
                          <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">
                            Color
                          </span>
                        )}
                        {printer.capabilities.duplex && (
                          <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">
                            Duplex
                          </span>
                        )}
                        {printer.capabilities.paperSizes?.map((size) => (
                          <span
                            key={size}
                            className="text-xs bg-slate-600 text-slate-300 px-2 py-0.5 rounded"
                          >
                            {size}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card bg-gradient-to-r from-blue-900/30 to-purple-900/30 border border-blue-500/30">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-500/20 rounded-full">
            <Monitor className="w-8 h-8 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">Need More Help?</h3>
            <p className="text-slate-400 text-sm">
              Untuk informasi lebih lanjut tentang setup dan troubleshooting, silakan lihat dokumentasi atau hubungi administrator sistem.
            </p>
          </div>
          <a
            href={`http://${serverInfo.ip}:${serverInfo.port}/help`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary flex items-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            Documentation
          </a>
        </div>
      </div>
    </div>
  );
}