'use client';

import { useEffect, useState } from 'react';
import { settings as settingsApi } from '@/lib/api';
import { Save, RefreshCw, Bell, Shield, Key, FileText, Check, AlertTriangle, Database, Download, FolderOpen, Info, RotateCcw, X, UploadCloud, Loader2 } from 'lucide-react';
import PaperManager from '@/components/PaperManager';

type TabType = 'general' | 'security' | 'defaults' | 'backup';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('general');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Backup state
  const [backups, setBackups] = useState<{ filename: string; size: string; createdAt: string }[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [triggeringBackup, setTriggeringBackup] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fetchSettings = async () => {
    try {
      const response = await settingsApi.get();
      setSettings(response.data);
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBackups = async () => {
    setBackupLoading(true);
    try {
      const response = await fetch('/api/settings/backup/list');
      if (response.ok) {
        const data = await response.json();
        setBackups(data);
      }
    } catch (err) {
      console.error('Failed to fetch backups list:', err);
    } finally {
      setBackupLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (activeTab === 'backup') {
      fetchBackups();
    }
  }, [activeTab]);

  const handleTriggerBackup = async () => {
    setTriggeringBackup(true);
    try {
      const response = await fetch('/api/settings/backup/trigger', { method: 'POST' });
      if (response.ok) {
        const result = await response.json();
        setMessage({ type: 'success', text: `Backup generated successfully: ${result.filename}` });
        fetchBackups();
      } else {
        setMessage({ type: 'error', text: 'Failed to generate backup' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to trigger backup' });
    } finally {
      setTriggeringBackup(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget) return;
    if (restoreConfirmText.trim().toUpperCase() !== 'RESTORE') return;
    setRestoring(true);
    try {
      const response = await fetch('/api/settings/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: restoreTarget }),
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setMessage({ type: 'success', text: `Database restored from ${result.filename}.` });
        setRestoreTarget(null);
        setRestoreConfirmText('');
        fetchBackups();
      } else {
        setMessage({ type: 'error', text: `Restore failed: ${result.details || result.error || 'unknown error'}` });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `Restore failed: ${err?.message || 'network error'}` });
    } finally {
      setRestoring(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const closeRestoreModal = () => {
    if (restoring) return;
    setRestoreTarget(null);
    setRestoreConfirmText('');
  };

  const handleUploadBackup = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.tar.gz')) {
      setMessage({ type: 'error', text: 'File harus berekstensi .tar.gz' });
      setTimeout(() => setMessage(null), 4000);
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'File terlalu besar (maks 100MB)' });
      setTimeout(() => setMessage(null), 4000);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use XHR for upload progress
      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/settings/backup/upload');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300) resolve(data);
            else reject(new Error(data.error || `HTTP ${xhr.status}`));
          } catch (e) {
            reject(new Error('Invalid server response'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(formData);
      });

      setMessage({ type: 'success', text: `Berhasil upload: ${result.originalName} → ${result.filename}` });
      fetchBackups();
    } catch (err: any) {
      setMessage({ type: 'error', text: `Upload gagal: ${err.message || 'unknown error'}` });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.update(settings);
      setMessage({ type: 'success', text: 'Settings saved successfully' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleChange = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="loading-state" style={{ minHeight: '300px' }}>
        <div className="loading-spinner" />
        <div>Fetching settings...</div>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: any; desc: string }[] = [
    { id: 'general', label: 'General', icon: Bell, desc: 'Basic system configurations' },
    { id: 'security', label: 'Security', icon: Shield, desc: 'Rate limit & sessions' },
    { id: 'defaults', label: 'Print Defaults', icon: FileText, desc: 'Paper sizes configuration' },
    { id: 'backup', label: 'Backup & Restore', icon: Database, desc: 'Database dump & restore tools' },
  ];

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
            <Shield size={20} />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '22px',
              color: 'var(--text-primary)',
              letterSpacing: '1px',
              margin: 0,
            }}>
              SYSTEM SETTINGS
            </h1>
            <p style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: '12px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              margin: 0,
            }}>
              Configure system alerts, paper defaults, and API rules
            </p>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
        >
          {saving ? (
            <RefreshCw size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
          ) : (
            <Save size={16} />
          )}
          Save Changes
        </button>
      </div>

      {/* ── Toast Message ───────────────────────────────────────────────── */}
      {message && (
        <div style={{
          padding: '14px 16px',
          borderRadius: '10px',
          background: message.type === 'success' ? 'rgba(0, 255, 136, 0.08)' : 'rgba(255, 61, 90, 0.08)',
          border: `1px solid ${message.type === 'success' ? 'rgba(0, 255, 136, 0.25)' : 'rgba(255, 61, 90, 0.25)'}`,
          color: message.type === 'success' ? 'var(--accent-green)' : 'var(--accent-red)',
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: '14px',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: message.type === 'success' ? '0 0 12px rgba(0, 255, 136, 0.1)' : '0 0 12px rgba(255, 61, 90, 0.1)',
        }}>
          {message.type === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}
          {message.text}
        </div>
      )}

      {/* ── Layout Grid ─────────────────────────────────────────────────── */}
      <div className="settings-layout">
        
        {/* Tab Left Panel */}
        <div className="settings-tabs-menu" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: isActive ? '1px solid var(--accent-cyan)' : '1px solid var(--border)',
                  background: isActive ? 'rgba(0, 212, 255, 0.04)' : 'var(--bg-card)',
                  boxShadow: isActive ? 'var(--glow-cyan)' : 'none',
                  transition: 'all 0.2s ease',
                }}
              >
                <Icon
                  size={18}
                  style={{
                    color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    flexShrink: 0,
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{
                    fontFamily: "'Rajdhani', sans-serif",
                    fontSize: '14px',
                    fontWeight: 700,
                    color: isActive ? 'var(--accent-cyan)' : 'var(--text-primary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {tab.label}
                  </span>
                  <span style={{
                    fontSize: '10px',
                    color: 'var(--text-muted)',
                    fontFamily: "'IBM Plex Sans', sans-serif",
                  }}>
                    {tab.desc}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Tab Content Card */}
        <div className="card" style={{ padding: '28px' }}>
          
          {/* GENERAL TAB */}
          {activeTab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <Bell style={{ color: 'var(--accent-cyan)' }} size={20} />
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 750, fontFamily: "'Rajdhani', sans-serif", margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>General Settings</h2>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Configure base check interval and log parameters</p>
                </div>
              </div>

              <div className="settings-form-grid">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Check Interval (seconds)
                  </label>
                  <input
                    type="number"
                    value={settings.check_interval || '30'}
                    onChange={(e) => handleChange('check_interval', e.target.value)}
                    className="input"
                    min="10"
                    max="300"
                    style={{ width: '100%', fontFamily: "'Share Tech Mono', monospace" }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>How often nodes query the server for new jobs (10 - 300s).</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Log Retention (days)
                  </label>
                  <input
                    type="number"
                    value={settings.log_retention_days || '30'}
                    onChange={(e) => handleChange('log_retention_days', e.target.value)}
                    className="input"
                    min="7"
                    max="365"
                    style={{ width: '100%', fontFamily: "'Share Tech Mono', monospace" }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Auto purge job records older than configured days (7 - 365d).</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '10px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Auto Heal Status
                </label>
                <select
                  value={settings.auto_heal || 'true'}
                  onChange={(e) => handleChange('auto_heal', e.target.value)}
                  className="input"
                  style={{ width: '100%', cursor: 'pointer' }}
                >
                  <option value="true">Enabled (Auto-resolve alerts, offline failover)</option>
                  <option value="false">Disabled (Manual overrides only)</option>
                </select>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  AutoHeal automatically detects stuck queue rows and checks offline printers.
                </span>
              </div>
            </div>
          )}


          {/* SECURITY TAB */}
          {activeTab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <Shield style={{ color: 'var(--accent-cyan)' }} size={20} />
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 750, fontFamily: "'Rajdhani', sans-serif", margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Security & Limits</h2>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Configure server request rate limiting and session limits</p>
                </div>
              </div>

              <div className="settings-form-grid">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Rate Limit (req/min)
                  </label>
                  <input
                    type="number"
                    value={settings.rate_limit_max || '100'}
                    onChange={(e) => handleChange('rate_limit_max', e.target.value)}
                    className="input"
                    min="10"
                    max="1000"
                    style={{ width: '100%', fontFamily: "'Share Tech Mono', monospace" }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Max requests per minute per IP to protect API endpoints.</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Session Timeout (minutes)
                  </label>
                  <input
                    type="number"
                    value={settings.session_timeout || '60'}
                    onChange={(e) => handleChange('session_timeout', e.target.value)}
                    className="input"
                    min="5"
                    max="480"
                    style={{ width: '100%', fontFamily: "'Share Tech Mono', monospace" }}
                  />
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Idle time before operators are logged out (5 - 480m).</span>
                </div>
              </div>

              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '16px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.05)',
                border: '1px solid rgba(245, 158, 11, 0.2)', marginTop: '12px'
              }}>
                <Key size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-amber)', fontFamily: "'Rajdhani', sans-serif", margin: '0 0 4px 0', textTransform: 'uppercase' }}>
                    API KEYS NOTE
                  </h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    PrintServer Node Agent API authentication keys are mapped directly to user accounts. You can generate, rotate, and manage API keys by navigating to the <strong>Users Management</strong> section.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* PRINT DEFAULTS (PAPERMANAGER) */}
          {activeTab === 'defaults' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <FileText style={{ color: 'var(--accent-cyan)' }} size={20} />
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 750, fontFamily: "'Rajdhani', sans-serif", margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Print Defaults</h2>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Configure default server-wide paper sizes and custom trays</p>
                </div>
              </div>

              {/* Embed PaperManager component directly */}
              <div style={{ marginTop: '8px' }}>
                <PaperManager />
              </div>
            </div>
          )}

          {/* BACKUP & RESTORE TAB */}
          {activeTab === 'backup' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <Database style={{ color: 'var(--accent-cyan)' }} size={20} />
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 750, fontFamily: "'Rajdhani', sans-serif", margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Backup & Database Migration</h2>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Ekspor database PostgreSQL, data printer, dan konfigurasi agen ke berkas backup</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '10px', padding: '20px', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                  <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Backup Manual Database & Konfigurasi</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Proses ini akan mengemas seluruh skema SQL, setelan printer, dan log alerts ke dalam berkas .tar.gz terkompresi.</span>
                </div>
                <button
                  onClick={handleTriggerBackup}
                  disabled={triggeringBackup}
                  className="btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', background: 'var(--accent-cyan)', borderColor: 'var(--accent-cyan)', color: '#000' }}
                >
                  {triggeringBackup ? (
                    <RefreshCw size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                  ) : (
                    <Database size={16} />
                  )}
                  {triggeringBackup ? 'Generating...' : 'Backup Now'}
                </button>
              </div>

              {/* Upload from another VPS */}
              <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px dashed rgba(0,212,255,0.35)', borderRadius: '10px', padding: '20px', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '260px' }}>
                  <span style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)' }}>Upload Backup dari VPS / Komputer Lain</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Untuk migrasi server: download backup dari VPS lama, lalu upload di sini dan klik Restore. Format: <code style={{ color: 'var(--accent-cyan)' }}>.tar.gz</code> (maks 100MB).
                  </span>
                  {uploading && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                        <span>Mengupload...</span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <div style={{ height: '4px', background: 'rgba(0,212,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${uploadProgress}%`, background: 'var(--accent-cyan)', transition: 'width 0.2s ease' }} />
                      </div>
                    </div>
                  )}
                </div>
                <label
                  htmlFor="backup-upload-input"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '9px 18px', cursor: uploading ? 'not-allowed' : 'pointer',
                    background: 'transparent', border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)',
                    borderRadius: '6px', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap',
                    opacity: uploading ? 0.5 : 1, pointerEvents: uploading ? 'none' : 'auto',
                  }}
                >
                  {uploading ? (
                    <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                  ) : (
                    <UploadCloud size={16} />
                  )}
                  {uploading ? 'Mengupload...' : 'Pilih File .tar.gz'}
                </label>
                <input
                  id="backup-upload-input"
                  type="file"
                  accept=".tar.gz,.tgz,application/gzip,application/x-gzip,application/x-tar"
                  style={{ display: 'none' }}
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadBackup(file);
                    e.target.value = ''; // reset so same file can be re-selected
                  }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase', letterSpacing: '0.5px' }}>Riwayat Berkas Backup di Server</h3>
                  <button onClick={fetchBackups} disabled={backupLoading} style={{ background: 'transparent', border: 'none', color: 'var(--accent-cyan)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px' }}>
                    <RefreshCw size={12} style={{ animation: backupLoading ? 'spin 1s linear' : 'none' }} /> Refresh
                  </button>
                </div>

                {backupLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100px', border: '1px solid var(--border)', borderRadius: '8px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Loading backups...</span>
                  </div>
                ) : backups.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100px', border: '1px dashed var(--border)', borderRadius: '8px', gap: '8px' }}>
                    <FolderOpen size={24} style={{ color: 'var(--text-dim)' }} />
                    <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Belum ada berkas backup yang tersimpan di server.</span>
                  </div>
                ) : (
                  <>
                    {/* Desktop: full table with horizontal scroll on narrow viewports */}
                    <div className="desktop-only" style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left', minWidth: '720px' }}>
                          <thead>
                            <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border)' }}>
                              <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>NAMA FILE BACKUP</th>
                              <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>UKURAN</th>
                              <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>TANGGAL BUAT</th>
                              <th style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center' }}>AKSI</th>
                            </tr>
                          </thead>
                          <tbody>
                            {backups.map((b) => (
                              <tr key={b.filename} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }} className="hover-row">
                                <td style={{ padding: '10px 12px', fontFamily: "'Share Tech Mono', monospace", color: 'var(--text-primary)' }}>{b.filename}</td>
                                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{b.size}</td>
                                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{new Date(b.createdAt).toLocaleString('id-ID')}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                                    <a
                                      href={`/api/settings/backup/download/${b.filename}`}
                                      download
                                      title={`Download ${b.filename}`}
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                                        padding: '6px 12px',
                                        color: '#000', background: 'var(--accent-green)', border: '1px solid var(--accent-green)',
                                        textDecoration: 'none', fontWeight: 700, fontSize: '12px',
                                        borderRadius: '5px', whiteSpace: 'nowrap',
                                        boxShadow: '0 0 8px rgba(0,255,136,0.25)',
                                      }}
                                    >
                                      <Download size={13} /> Download
                                    </a>
                                    <button
                                      onClick={() => setRestoreTarget(b.filename)}
                                      title={`Restore from ${b.filename}`}
                                      style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                                        padding: '6px 12px',
                                        color: '#fff', background: 'rgba(255,61,90,0.15)',
                                        border: '1px solid var(--accent-red)', borderRadius: '5px',
                                        cursor: 'pointer', fontWeight: 700, fontSize: '12px',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      <RotateCcw size={13} /> Restore
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Mobile: stacked cards with full-width action buttons */}
                    <div className="mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {backups.map((b) => (
                        <div key={b.filename} style={{
                          border: '1px solid var(--border)', borderRadius: '10px',
                          background: 'var(--bg-secondary)', padding: '14px',
                          display: 'flex', flexDirection: 'column', gap: '10px',
                        }}>
                          <div style={{
                            fontFamily: "'Share Tech Mono', monospace", fontSize: '12px',
                            color: 'var(--accent-cyan)', wordBreak: 'break-all', lineHeight: 1.4,
                          }}>
                            {b.filename}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Ukuran: <span style={{ color: 'var(--text-primary)' }}>{b.size}</span></span>
                            <span style={{ color: 'var(--text-muted)' }}>{new Date(b.createdAt).toLocaleString('id-ID')}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                            <a
                              href={`/api/settings/backup/download/${b.filename}`}
                              download
                              style={{
                                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                padding: '10px 12px', minHeight: '44px',
                                color: '#000', background: 'var(--accent-green)', border: '1px solid var(--accent-green)',
                                textDecoration: 'none', fontWeight: 700, fontSize: '13px', borderRadius: '6px',
                                boxShadow: '0 0 8px rgba(0,255,136,0.25)',
                              }}
                            >
                              <Download size={15} /> Download
                            </a>
                            <button
                              onClick={() => setRestoreTarget(b.filename)}
                              style={{
                                flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                                padding: '10px 12px', minHeight: '44px',
                                color: '#fff', background: 'rgba(255,61,90,0.15)',
                                border: '1px solid var(--accent-red)', borderRadius: '6px',
                                cursor: 'pointer', fontWeight: 700, fontSize: '13px',
                              }}
                            >
                              <RotateCcw size={15} /> Restore
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '16px', borderRadius: '8px', background: 'rgba(0, 255, 136, 0.05)',
                border: '1px solid rgba(0, 255, 136, 0.2)', marginTop: '12px'
              }}>
                <Info size={18} style={{ color: 'var(--accent-green)', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-green)', fontFamily: "'Rajdhani', sans-serif", margin: '0 0 4px 0', textTransform: 'uppercase' }}>
                    Sistem Backup Harian
                  </h4>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                    Sistem secara otomatis melakukan backup database dan konfigurasi <strong>setiap hari pukul 02:00 pagi</strong>. Berkas backup yang berumur <strong>lebih dari 14 hari</strong> akan otomatis dibersihkan demi menghemat ruang penyimpanan server.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* RESTORE CONFIRMATION MODAL */}
          {restoreTarget && (
            <div
              onClick={closeRestoreModal}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000, padding: '20px',
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'var(--bg-primary, #0f1419)', border: '1px solid rgba(255,61,90,0.4)',
                  borderRadius: '12px', padding: '24px', maxWidth: '480px', width: '100%',
                  boxShadow: '0 0 30px rgba(255,61,90,0.15)',
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: 'rgba(255,61,90,0.12)', border: '1px solid rgba(255,61,90,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--accent-red, #ff3d5a)', flexShrink: 0,
                  }}>
                    <AlertTriangle size={20} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: '16px', fontWeight: 700, color: 'var(--accent-red, #ff3d5a)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                      Konfirmasi Restore Database
                    </h3>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                      Tindakan ini tidak dapat dibatalkan
                    </p>
                  </div>
                  <button
                    onClick={closeRestoreModal}
                    disabled={restoring}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: restoring ? 'not-allowed' : 'pointer', padding: '4px' }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* File name */}
                <div style={{
                  background: 'rgba(0,212,255,0.05)', border: '1px solid rgba(0,212,255,0.2)',
                  borderRadius: '6px', padding: '10px 12px', marginBottom: '14px',
                  fontFamily: "'Share Tech Mono', monospace", fontSize: '12px',
                  color: 'var(--accent-cyan)', wordBreak: 'break-all',
                }}>
                  {restoreTarget}
                </div>

                {/* What will happen */}
                <div style={{ marginBottom: '16px' }}>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                    Restore akan:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.7 }}>
                    <li><strong>Menghapus & membuat ulang</strong> database <code style={{ color: 'var(--accent-cyan)' }}>printserver</code></li>
                    <li>Mengganti seluruh konfigurasi client-agent</li>
                    <li>Mengganti folder <code style={{ color: 'var(--accent-cyan)' }}>public/downloads</code></li>
                    <li>Job yang sedang berjalan di queue dapat terpengaruh</li>
                  </ul>
                </div>

                {/* Confirm input */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                    Ketik <strong style={{ color: 'var(--accent-red, #ff3d5a)' }}>RESTORE</strong> untuk melanjutkan
                  </label>
                  <input
                    type="text"
                    value={restoreConfirmText}
                    onChange={(e) => setRestoreConfirmText(e.target.value)}
                    placeholder="RESTORE"
                    disabled={restoring}
                    autoFocus
                    className="input"
                    style={{ width: '100%', fontFamily: "'Share Tech Mono', monospace", textAlign: 'center', letterSpacing: '2px' }}
                  />
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={closeRestoreModal}
                    disabled={restoring}
                    style={{
                      padding: '9px 18px', background: 'transparent',
                      border: '1px solid var(--border)', color: 'var(--text-muted)',
                      borderRadius: '6px', cursor: restoring ? 'not-allowed' : 'pointer', fontSize: '13px',
                    }}
                  >
                    Batal
                  </button>
                  <button
                    onClick={handleRestore}
                    disabled={restoring || restoreConfirmText.trim().toUpperCase() !== 'RESTORE'}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '9px 18px', background: 'var(--accent-red, #ff3d5a)',
                      border: '1px solid var(--accent-red, #ff3d5a)', color: '#fff',
                      borderRadius: '6px',
                      cursor: (restoring || restoreConfirmText.trim().toUpperCase() !== 'RESTORE') ? 'not-allowed' : 'pointer',
                      opacity: (restoring || restoreConfirmText.trim().toUpperCase() !== 'RESTORE') ? 0.5 : 1,
                      fontWeight: 700, fontSize: '13px',
                    }}
                  >
                    {restoring ? (
                      <>
                        <RefreshCw size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                        Restoring...
                      </>
                    ) : (
                      <>
                        <RotateCcw size={14} />
                        Ya, Restore Sekarang
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
