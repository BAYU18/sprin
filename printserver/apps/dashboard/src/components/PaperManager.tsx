'use client';

import { useEffect, useState } from 'react';
import { paper as paperApi } from '@/lib/api';
import { Plus, Trash2, FileText, Check, Star, Ruler, X } from 'lucide-react';

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
      console.error('FETCH ALL PAPER ERROR:', err);
      setMessage({ type: 'error', text: `Failed to load paper sizes: ${err.message || err}` });
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

  // Mini visual paper preview — aspect ratio reflects real dimensions.
  const PaperGlyph = ({ w, h, color }: { w: number; h: number; color: string }) => {
    const ratio = w / h;
    const boxH = 34;
    const boxW = Math.max(14, Math.min(40, boxH * ratio));
    return (
      <div style={{
        width: 44, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <div style={{
          width: boxW, height: boxH,
          border: `1.5px solid ${color}`,
          borderRadius: 3,
          background: `${color}14`,
          boxShadow: `0 0 8px ${color}40`,
          position: 'relative',
        }}>
          <div style={{ position: 'absolute', top: 4, left: 3, right: 3, height: 1.5, background: `${color}55`, borderRadius: 2 }} />
          <div style={{ position: 'absolute', top: 8, left: 3, right: 6, height: 1.5, background: `${color}40`, borderRadius: 2 }} />
          <div style={{ position: 'absolute', top: 12, left: 3, right: 4, height: 1.5, background: `${color}30`, borderRadius: 2 }} />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 128, gap: 10, color: 'var(--text-muted)' }}>
        <Ruler size={16} style={{ animation: 'spin 1.5s linear infinite' }} />
        <span style={{ fontSize: 13 }}>Loading paper sizes...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {message && (
        <div style={{
          padding: '12px 14px', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
          color: message.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
          background: message.type === 'success' ? 'rgba(0,255,136,0.08)' : 'rgba(255,61,90,0.08)',
          border: `1px solid ${message.type === 'success' ? 'rgba(0,255,136,0.35)' : 'rgba(255,61,90,0.35)'}`,
          boxShadow: message.type === 'success' ? 'var(--glow-green)' : 'var(--glow-red)',
        }}>
          {message.type === 'success' ? <Check size={15} /> : <X size={15} />}
          {message.text}
        </div>
      )}

      {/* ===== Default paper size — clickable card grid ===== */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Star size={15} style={{ color: 'var(--accent-amber)' }} />
          <h3 style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-primary)', margin: 0 }}>
            Server-wide Default
          </h3>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          Klik salah satu ukuran untuk menjadikannya default. Berlaku untuk semua printer tanpa override khusus.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {allSizes.map((s) => {
            const isDefault = s.name === defaultName;
            return (
              <button
                key={s.name}
                onClick={() => !isDefault && handleSetDefault(s.name)}
                disabled={saving}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                  padding: '10px 12px', borderRadius: 10, cursor: isDefault ? 'default' : 'pointer',
                  background: isDefault ? 'rgba(0,212,255,0.1)' : 'var(--bg-secondary)',
                  border: `1px solid ${isDefault ? 'var(--accent-cyan)' : 'var(--border)'}`,
                  boxShadow: isDefault ? 'var(--glow-cyan)' : 'none',
                  transition: 'all 0.2s ease', position: 'relative',
                }}
              >
                <PaperGlyph w={s.widthMm} h={s.heightMm} color={isDefault ? 'var(--accent-cyan)' : 'var(--text-muted)'} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: isDefault ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>{s.name}</span>
                    {!s.builtin && (
                      <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: 'var(--accent-amber)', fontWeight: 700, letterSpacing: '0.5px' }}>CUSTOM</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Share Tech Mono', monospace" }}>
                    {s.widthMm}×{s.heightMm} mm
                  </div>
                </div>
                {isDefault && (
                  <div style={{ position: 'absolute', top: 6, right: 6, color: 'var(--accent-cyan)' }}>
                    <Check size={14} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ===== Custom paper sizes ===== */}
      <section style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileText size={15} style={{ color: 'var(--accent-cyan)' }} />
            <h3 style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-primary)', margin: 0 }}>
              Custom Paper Sizes
            </h3>
            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: "'Share Tech Mono', monospace" }}>
              {customSizes.length}
            </span>
          </div>
          {!showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8,
                background: 'rgba(0,212,255,0.1)', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s ease',
              }}
            >
              <Plus size={14} /> Add Custom
            </button>
          )}
        </div>

        {showAddForm && (
          <div style={{
            background: 'var(--bg-secondary)', borderRadius: 12, padding: 18, marginBottom: 16,
            border: '1px solid rgba(0,212,255,0.35)', boxShadow: 'var(--glow-cyan)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Kwitansi, Amplop-DL..."
                  className="input w-full"
                  maxLength={40}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Width (mm)</label>
                <input
                  type="number"
                  value={newWidth}
                  onChange={(e) => setNewWidth(e.target.value)}
                  className="input w-full"
                  min="1" max="2000" step="0.1"
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Height (mm)</label>
                <input
                  type="number"
                  value={newHeight}
                  onChange={(e) => setNewHeight(e.target.value)}
                  className="input w-full"
                  min="1" max="2000" step="0.1"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleAddCustom}
                disabled={saving}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8,
                  background: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)', color: '#04121a',
                  fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                <Check size={15} /> Save
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewName(''); }}
                disabled={saving}
                style={{
                  padding: '8px 16px', borderRadius: 8, background: 'transparent',
                  border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {customSizes.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '28px 16px', border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-muted)',
          }}>
            <FileText size={22} style={{ color: 'var(--text-dim)' }} />
            <span style={{ fontSize: 12 }}>Belum ada ukuran kertas custom.</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
            {customSizes.map((s) => (
              <div
                key={s.name}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg-secondary)', borderRadius: 10, padding: '10px 12px',
                  border: '1px solid var(--border)',
                }}
              >
                <PaperGlyph w={s.widthMm} h={s.heightMm} color="var(--accent-amber)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Share Tech Mono', monospace" }}>
                    {s.widthMm}×{s.heightMm} mm
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(s.name)}
                  disabled={saving}
                  title="Remove"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8,
                    background: 'rgba(255,61,90,0.1)', border: '1px solid rgba(255,61,90,0.3)', color: 'var(--accent-red)',
                    cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s ease',
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ===== Built-in reference ===== */}
      {!compact && (
        <section style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Ruler size={15} style={{ color: 'var(--text-muted)' }} />
            <h3 style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-primary)', margin: 0 }}>
              Built-in Sizes
            </h3>
            <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: "'Share Tech Mono', monospace" }}>
              {allSizes.filter(s => s.builtin).length}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6 }}>
            {allSizes.filter(s => s.builtin).map(s => (
              <div key={s.name} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--bg-primary)', borderRadius: 6, padding: '6px 10px',
                border: '1px solid var(--border)', fontSize: 12,
              }}>
                <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: 'var(--text-muted)', fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}>{s.widthMm}×{s.heightMm}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
