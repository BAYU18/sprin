'use client';

import { useEffect, useState } from 'react';
import { paper as paperApi, printers as printersApi } from '@/lib/api';
import { X, Save, FileText, Check } from 'lucide-react';

interface PaperSize {
  name: string;
  widthMm: number;
  heightMm: number;
  builtin: boolean;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
  // Optional: pre-fill from a Windows node (so admin can quickly add
  // a printer that's already on the agent but not yet registered).
  prefill?: { name?: string; client_id?: number };
}

export default function AddPrinterModal({ onClose, onCreated, prefill }: Props) {
  const [allSizes, setAllSizes] = useState<PaperSize[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [name, setName] = useState(prefill?.name || '');
  const [driver, setDriver] = useState('Generic / Text Only');
  const [port, setPort] = useState('NODE');
  const [type, setType] = useState<'network' | 'usb' | 'thermal' | 'pdf'>('network');
  const [isShared, setIsShared] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [clientId, setClientId] = useState<string>(prefill?.client_id ? String(prefill.client_id) : '');

  // Paper
  const [paperSize, setPaperSize] = useState('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [tray, setTray] = useState('auto');
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');

  // Clients list (so admin can pick which node owns the printer)
  const [clients, setClients] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [sizes, clientsResp] = await Promise.all([
          paperApi.list(),
          fetch('/api/clients', { credentials: 'include' }).then((r) => r.ok ? r.json() : []),
        ]);
        setAllSizes(sizes.data.sizes);
        setClients(Array.isArray(clientsResp) ? clientsResp : (clientsResp.data || []));
      } catch (e) {
        setMessage({ type: 'error', text: 'Failed to load form data' });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const selectedSize = allSizes.find((s) => s.name === paperSize);
  const needsCustomDims = selectedSize && !selectedSize.builtin && (!customW || !customH);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!name.trim()) {
      setMessage({ type: 'error', text: 'Printer name required' });
      return;
    }

    // Build paper config
    const paper: any = { size: paperSize, orientation, tray };
    const matched = allSizes.find((s) => s.name === paperSize);
    if (customW && customH) {
      paper.customWidthMm = parseFloat(customW);
      paper.customHeightMm = parseFloat(customH);
    } else if (matched && !matched.builtin) {
      paper.customWidthMm = matched.widthMm;
      paper.customHeightMm = matched.heightMm;
    }

    setSaving(true);
    try {
      const payload: any = {
        name: name.trim(),
        driver,
        port,
        type,
        is_shared: isShared,
        is_default: isDefault,
        config: { paper },
      };
      if (clientId) payload.client_id = parseInt(clientId);

      const resp = await printersApi.create(payload);
      setMessage({ type: 'success', text: `Created "${resp.data.name}"` });
      onCreated();
      setTimeout(onClose, 600);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.response?.data?.error || 'Failed to create' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-slate-800 rounded-lg p-6 text-slate-300">Loading...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-400" />
              Add printer
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Manually register a printer and select the paper size installed on it.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {message && (
          <div className={`p-3 rounded-lg border text-sm mb-4 ${
            message.type === 'success'
              ? 'bg-green-500/10 border-green-500/30 text-green-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Printer name *</label>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="EPSON L3110 Lantai 2"
              className="input w-full" required maxLength={255}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Driver</label>
              <input
                type="text" value={driver} onChange={(e) => setDriver(e.target.value)}
                className="input w-full" placeholder="EPSON L3110 Series"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Port</label>
              <input
                type="text" value={port} onChange={(e) => setPort(e.target.value)}
                className="input w-full" placeholder="USB001 / NODE / tcp://..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as any)} className="input w-full">
                <option value="network">Network (node-bound)</option>
                <option value="usb">USB / Local</option>
                <option value="thermal">Thermal / Receipt</option>
                <option value="pdf">PDF Virtual</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Bound to node (optional)</label>
              <select
                value={clientId} onChange={(e) => setClientId(e.target.value)}
                className="input w-full"
              >
                <option value="">— Unbound (no node) —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.hostname}{c.ip_address ? ` (${c.ip_address})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
              Shared
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Default printer
            </label>
          </div>

          <div className="border-t border-slate-700 pt-4">
            <h3 className="font-medium mb-3 flex items-center gap-2 text-cyan-400">
              <FileText className="w-4 h-4" />
              Paper installed in this printer
            </h3>
            <p className="text-xs text-slate-500 mb-3">
              When users print to this printer, the agent will use this paper size by default.
              You can change it later in Printers → Paper config.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Paper size *</label>
                <select
                  value={paperSize} onChange={(e) => setPaperSize(e.target.value)}
                  className="input w-full"
                >
                  {allSizes.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.widthMm}×{s.heightMm}mm){s.builtin ? '' : ' [custom]'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Orientation</label>
                  <select
                    value={orientation} onChange={(e) => setOrientation(e.target.value as any)}
                    className="input w-full"
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Tray</label>
                  <select value={tray} onChange={(e) => setTray(e.target.value)} className="input w-full">
                    <option value="auto">Auto-select</option>
                    <option value="tray-1">Tray 1</option>
                    <option value="tray-2">Tray 2</option>
                    <option value="tray-3">Tray 3</option>
                    <option value="manual">Manual feed</option>
                  </select>
                </div>
              </div>

              {selectedSize && !selectedSize.builtin && (
                <div className="grid grid-cols-2 gap-3 bg-slate-700/30 rounded-lg p-3 border border-slate-600">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Width (mm)</label>
                    <input
                      type="number" value={customW} onChange={(e) => setCustomW(e.target.value)}
                      className="input w-full" min="1" max="2000" step="0.1"
                      placeholder={String(selectedSize.widthMm)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">Height (mm)</label>
                    <input
                      type="number" value={customH} onChange={(e) => setCustomH(e.target.value)}
                      className="input w-full" min="1" max="2000" step="0.1"
                      placeholder={String(selectedSize.heightMm)}
                    />
                  </div>
                </div>
              )}

              {needsCustomDims && (
                <div className="text-xs text-yellow-400">
                  ⚠ Please specify width &amp; height for this custom size.
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-700">
            <button
              type="submit"
              disabled={saving || needsCustomDims}
              className="btn-primary flex items-center gap-1"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Creating...' : 'Add printer'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
          </div>

          {prefill?.client_id && (
            <div className="text-xs text-slate-500 bg-slate-700/20 rounded p-2">
              💡 Once added, the bound node agent will pick up the paper config on its next heartbeat.
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
