'use client';

import { useEffect, useState } from 'react';
import { paper as paperApi } from '@/lib/api';
import { Plus, Trash2, FileText, Check } from 'lucide-react';

interface PaperSize {
  name: string;
  widthMm: number;
  heightMm: number;
  builtin: boolean;
}

export default function PaperManager({ compact = false }: { compact?: boolean }) {
  const [allSizes, setAllSizes] = useState<PaperSize[]>([]);
  const [customSizes, setCustomSizes] = useState<PaperSize[]>([]);
  const [defaultName, setDefaultName] = useState<string>('A4');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add-custom form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWidth, setNewWidth] = useState('210');
  const [newHeight, setNewHeight] = useState('297');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [list, custom, def] = await Promise.all([
        paperApi.list(),
        paperApi.getCustom(),
        paperApi.getDefault(),
      ]);
      setAllSizes(list.data.sizes);
      setCustomSizes(custom.data.custom);
      setDefaultName(def.data.default);
    } catch (err: any) {
      setMessage({ type: 'error', text: 'Failed to load paper sizes' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAddCustom = async () => {
    if (!newName.trim()) {
      showMessage('error', 'Name required');
      return;
    }
    const w = parseFloat(newWidth), h = parseFloat(newHeight);
    if (!w || w <= 0 || w > 2000 || !h || h <= 0 || h > 2000) {
      showMessage('error', 'Dimensions must be 1-2000 mm');
      return;
    }
    setSaving(true);
    try {
      await paperApi.addCustom({ name: newName.trim(), widthMm: w, heightMm: h });
      showMessage('success', `Added ${newName}`);
      setNewName(''); setNewWidth('210'); setNewHeight('297');
      setShowAddForm(false);
      await fetchAll();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.error || 'Failed to add');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (name: string) => {
    if (!confirm(`Remove custom paper size "${name}"?`)) return;
    setSaving(true);
    try {
      await paperApi.removeCustom(name);
      showMessage('success', `Removed ${name}`);
      await fetchAll();
    } catch (err: any) {
      showMessage('error', err?.response?.data?.error || 'Failed to remove');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (name: string) => {
    setSaving(true);
    try {
      await paperApi.setDefault(name);
      setDefaultName(name);
      showMessage('success', `Default paper set to ${name}`);
    } catch (err: any) {
      showMessage('error', err?.response?.data?.error || 'Failed to set default');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-slate-400 text-sm">Loading paper sizes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {message && (
        <div className={`p-3 rounded-lg border text-sm ${
          message.type === 'success'
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      <div>
        <label className="block text-sm text-slate-400 mb-2">
          Server-wide default paper size
        </label>
        <select
          value={defaultName}
          onChange={(e) => handleSetDefault(e.target.value)}
          disabled={saving}
          className="input w-auto min-w-[200px]"
        >
          {allSizes.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name} ({s.widthMm}×{s.heightMm}mm) {s.builtin ? '' : '(custom)'}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500 mt-1">
          Applied to all printers that don't have a per-printer override.
        </p>
      </div>

      <div className="border-t border-slate-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium flex items-center gap-2">
            <FileText className="w-4 h-4" /> Custom paper sizes
            <span className="text-xs text-slate-500">({customSizes.length})</span>
          </h3>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="btn-secondary flex items-center gap-1 text-sm"
            >
              <Plus className="w-4 h-4" /> Add custom
            </button>
          )}
        </div>

        {showAddForm && (
          <div className="bg-slate-700/30 rounded-lg p-4 mb-3 border border-slate-600">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Kwitansi, Amplop-DL, etc."
                  className="input w-full"
                  maxLength={40}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Width (mm)</label>
                <input
                  type="number"
                  value={newWidth}
                  onChange={(e) => setNewWidth(e.target.value)}
                  className="input w-full"
                  min="1" max="2000" step="0.1"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Height (mm)</label>
                <input
                  type="number"
                  value={newHeight}
                  onChange={(e) => setNewHeight(e.target.value)}
                  className="input w-full"
                  min="1" max="2000" step="0.1"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddCustom}
                disabled={saving}
                className="btn-primary flex items-center gap-1 text-sm"
              >
                <Check className="w-4 h-4" /> Save
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewName(''); }}
                disabled={saving}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {customSizes.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No custom paper sizes yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {customSizes.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between bg-slate-700/40 rounded-lg p-3 border border-slate-600"
              >
                <div>
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-slate-400">
                    {s.widthMm}×{s.heightMm}mm
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(s.name)}
                  disabled={saving}
                  className="text-red-400 hover:text-red-300 p-1"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!compact && (
        <div className="border-t border-slate-700 pt-4">
          <h3 className="font-medium mb-2 text-sm text-slate-300">
            Built-in paper sizes ({allSizes.filter(s => s.builtin).length})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-xs text-slate-400">
            {allSizes.filter(s => s.builtin).map(s => (
              <div key={s.name} className="flex justify-between bg-slate-800/40 rounded px-2 py-1">
                <span>{s.name}</span>
                <span className="text-slate-500">{s.widthMm}×{s.heightMm}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
