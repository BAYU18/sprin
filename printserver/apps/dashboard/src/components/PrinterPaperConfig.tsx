'use client';

import { useEffect, useState } from 'react';
import { paper as paperApi } from '@/lib/api';
import { FileText, X, Save, RotateCcw } from 'lucide-react';

interface PaperSize {
  name: string;
  widthMm: number;
  heightMm: number;
  builtin: boolean;
}

interface Props {
  printerId: number;
  printerName: string;
  onClose: () => void;
}

export default function PrinterPaperConfig({ printerId, printerName, onClose }: Props) {
  const [allSizes, setAllSizes] = useState<PaperSize[]>([]);
  const [override, setOverride] = useState<any | null>(null);
  const [effective, setEffective] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [size, setSize] = useState('A4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [tray, setTray] = useState('auto');
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [list, pap] = await Promise.all([
        paperApi.list(),
        paperApi.getForPrinter(printerId),
      ]);
      setAllSizes(list.data.sizes);
      setOverride(pap.data.override);
      setEffective(pap.data.effective);
      // Initialize form with override (or effective) values
      const initial = pap.data.override || pap.data.effective || { size: 'A4' };
      setSize(initial.size || 'A4');
      setOrientation(initial.orientation || 'portrait');
      setTray(initial.tray || 'auto');
      setCustomW(initial.customWidthMm ? String(initial.customWidthMm) : '');
      setCustomH(initial.customHeightMm ? String(initial.customHeightMm) : '');
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to load' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [printerId]);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = { size, orientation, tray };
      const matched = allSizes.find((s) => s.name === size);
      // Always include custom dims if specified or if the size is custom
      if (customW && customH) {
        payload.customWidthMm = parseFloat(customW);
        payload.customHeightMm = parseFloat(customH);
      } else if (matched && !matched.builtin) {
        payload.customWidthMm = matched.widthMm;
        payload.customHeightMm = matched.heightMm;
      }
      const resp = await paperApi.setForPrinter(printerId, payload);
      setOverride(resp.data.override);
      setEffective(resp.data.effective);
      showMessage('success', 'Saved');
    } catch (err: any) {
      showMessage('error', err?.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Remove per-printer paper override? Printer will use server default.')) return;
    setSaving(true);
    try {
      const resp = await paperApi.clearForPrinter(printerId);
      setOverride(null);
      setEffective(resp.data.effective);
      setSize(resp.data.effective.size);
      setOrientation(resp.data.effective.orientation);
      setTray(resp.data.effective.tray);
      setCustomW('');
      setCustomH('');
      showMessage('success', 'Override removed');
    } catch (err: any) {
      showMessage('error', err?.response?.data?.error || 'Failed to clear');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
        <div className="bg-slate-800 rounded-lg p-6 text-slate-300">Loading...</div>
      </div>
    );
  }

  const selectedSize = allSizes.find((s) => s.name === size);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-400" />
              Paper configuration
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {printerName} <span className="text-slate-500">(ID #{printerId})</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {effective && (
          <div className="bg-slate-700/40 rounded-lg p-3 mb-4 text-sm border border-slate-600">
            <div className="text-slate-400 text-xs mb-1">Currently in effect</div>
            <div className="font-mono">
              {effective.size}
              {effective.customWidthMm ? ` (${effective.customWidthMm}×${effective.customHeightMm}mm)` : ''}
              {' · '}{effective.orientation} · {effective.tray}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {override
                ? '✓ Per-printer override active'
                : '· Inheriting from server default'}
            </div>
          </div>
        )}

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
            <label className="block text-sm text-slate-300 mb-1">Paper size</label>
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="input w-full"
            >
              {allSizes.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.widthMm}×{s.heightMm}mm){s.builtin ? '' : ' [custom]'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Orientation</label>
            <select
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as any)}
              className="input w-full"
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Paper tray</label>
            <select
              value={tray}
              onChange={(e) => setTray(e.target.value)}
              className="input w-full"
            >
              <option value="auto">Auto-select</option>
              <option value="tray-1">Tray 1</option>
              <option value="tray-2">Tray 2</option>
              <option value="tray-3">Tray 3</option>
              <option value="manual">Manual feed</option>
            </select>
          </div>

          {selectedSize && !selectedSize.builtin && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-slate-300 mb-1">Width (mm)</label>
                <input
                  type="number" value={customW} onChange={(e) => setCustomW(e.target.value)}
                  className="input w-full" min="1" max="2000" step="0.1"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Height (mm)</label>
                <input
                  type="number" value={customH} onChange={(e) => setCustomH(e.target.value)}
                  className="input w-full" min="1" max="2000" step="0.1"
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-slate-700">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary flex items-center gap-1"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save override'}
            </button>
            {override && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="btn-secondary flex items-center gap-1"
              >
                <RotateCcw className="w-4 h-4" />
                Reset to default
              </button>
            )}
          </div>

          <div className="text-xs text-slate-500 bg-slate-700/20 rounded p-2">
            💡 Add new paper sizes (e.g. custom forms) from{' '}
            <strong>Settings → Print Defaults</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}
