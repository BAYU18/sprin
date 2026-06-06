'use client';

import { useEffect, useState } from 'react';
import { settings as settingsApi } from '@/lib/api';
import { Save, RefreshCw, Mail, Bell, Shield, Key, FileText, Check, AlertTriangle, Database, Download, FolderOpen, Info } from 'lucide-react';
import PaperManager from '@/components/PaperManager';

type TabType = 'general' | 'smtp' | 'security' | 'defaults' | 'backup';

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
    { id: 'smtp', label: 'Email Alerts', icon: Mail, desc: 'SMTP & recipients' },
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
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '24px' }}>
        
        {/* Tab Left Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
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

          {/* SMTP TAB */}
          {activeTab === 'smtp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
                <Mail style={{ color: 'var(--accent-cyan)' }} size={20} />
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 750, fontFamily: "'Rajdhani', sans-serif", margin: 0, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email Alerts</h2>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>Configure SMTP transport and recipient credentials</p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: "'Rajdhani', sans-serif", fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Alert Dispatcher
                </label>
                <select
                  value={settings.email_alert || 'false'}
                  onChange={(e) => handleChange('email_alert', e.target.value)}
                  className="input"
                  style={{ width: '100%', cursor: 'pointer' }}
                >
                  <option value="false">Disabled (Alerts stored inside database only)</option>
                  <option value="true">Enabled (Dispatch alerts via SMTP)</option>
                </select>
              </div>

              {settings.email_alert === 'true' && (
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '16px',
                  padding: '20px', borderRadius: '10px', background: 'rgba(0,0,0,0.15)',
                  border: '1px dashed var(--border)', marginTop: '8px'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>SMTP Host</label>
                      <input
                        type="text"
                        value={settings.smtp_host || ''}
                        onChange={(e) => handleChange('smtp_host', e.target.value)}
                        className="input"
                        placeholder="smtp.gmail.com"
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>SMTP Port</label>
                      <input
                        type="text"
                        value={settings.smtp_port || '587'}
                        onChange={(e) => handleChange('smtp_port', e.target.value)}
                        className="input"
                        placeholder="587"
                        style={{ fontFamily: "'Share Tech Mono', monospace" }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>SMTP Username</label>
                    <input
                      type="text"
                      value={settings.smtp_user || ''}
                      onChange={(e) => handleChange('smtp_user', e.target.value)}
                      className="input"
                      placeholder="alerts@domain.com"
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recipients (comma separated)</label>
                    <input
                      type="text"
                      value={settings.email_to || ''}
                      onChange={(e) => handleChange('email_to', e.target.value)}
                      className="input"
                      placeholder="admin@domain.com, operator@domain.com"
                    />
                  </div>
                </div>
              )}
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
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
                  <div style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
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
                              <a
                                href={`/api/settings/backup/download/${b.filename}`}
                                download
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--accent-green)', textDecoration: 'none', fontWeight: 600, fontSize: '12px' }}
                              >
                                <Download size={14} /> Download
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
          
        </div>

      </div>

    </div>
  );
}
