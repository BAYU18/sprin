'use client';

import { useEffect, useState } from 'react';
import { settings as settingsApi, users as usersApi } from '@/lib/api';
import { Save, RefreshCw, Mail, Bell, Shield, Key } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  useEffect(() => {
    fetchSettings();
  }, []);

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
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Settings</h1>
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Changes
        </button>
      </div>

      {message && (
        <div className={`p-4 rounded-lg border ${
          message.type === 'success'
            ? 'bg-green-500/20 border-green-500 text-green-400'
            : 'bg-red-500/20 border-red-500 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Bell className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">General Settings</h2>
            <p className="text-sm text-slate-400">Configure basic system settings</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Check Interval (seconds)</label>
            <input
              type="number"
              value={settings.check_interval || '30'}
              onChange={(e) => handleChange('check_interval', e.target.value)}
              className="input w-32"
              min="10"
              max="300"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Auto Heal</label>
            <select
              value={settings.auto_heal || 'true'}
              onChange={(e) => handleChange('auto_heal', e.target.value)}
              className="input w-auto"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Log Retention (days)</label>
            <input
              type="number"
              value={settings.log_retention_days || '30'}
              onChange={(e) => handleChange('log_retention_days', e.target.value)}
              className="input w-32"
              min="7"
              max="365"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-green-500/20 rounded-lg">
            <Mail className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Email Notifications</h2>
            <p className="text-sm text-slate-400">Configure email alert settings</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Email Alerts</label>
            <select
              value={settings.email_alert || 'false'}
              onChange={(e) => handleChange('email_alert', e.target.value)}
              className="input w-auto"
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </div>

          {settings.email_alert === 'true' && (
            <>
              <div>
                <label className="block text-sm text-slate-400 mb-1">SMTP Host</label>
                <input
                  type="text"
                  value={settings.smtp_host || ''}
                  onChange={(e) => handleChange('smtp_host', e.target.value)}
                  className="input"
                  placeholder="smtp.gmail.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">SMTP Port</label>
                  <input
                    type="text"
                    value={settings.smtp_port || '587'}
                    onChange={(e) => handleChange('smtp_port', e.target.value)}
                    className="input"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">SMTP User</label>
                <input
                  type="text"
                  value={settings.smtp_user || ''}
                  onChange={(e) => handleChange('smtp_user', e.target.value)}
                  className="input"
                  placeholder="your-email@gmail.com"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-400 mb-1">Email Recipients</label>
                <input
                  type="text"
                  value={settings.email_to || ''}
                  onChange={(e) => handleChange('email_to', e.target.value)}
                  className="input"
                  placeholder="admin@example.com, ops@example.com"
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Shield className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Security</h2>
            <p className="text-sm text-slate-400">Configure security settings</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Rate Limit (requests/minute)</label>
            <input
              type="number"
              value={settings.rate_limit_max || '100'}
              onChange={(e) => handleChange('rate_limit_max', e.target.value)}
              className="input w-32"
              min="10"
              max="1000"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Session Timeout (minutes)</label>
            <input
              type="number"
              value={settings.session_timeout || '60'}
              onChange={(e) => handleChange('session_timeout', e.target.value)}
              className="input w-32"
              min="5"
              max="480"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-yellow-500/20 rounded-lg">
            <Key className="w-5 h-5 text-yellow-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">API Keys</h2>
            <p className="text-sm text-slate-400">Manage API access keys</p>
          </div>
        </div>

        <p className="text-slate-400 text-sm">
          API keys can be generated and managed from the Users section.
        </p>
      </div>
    </div>
  );
}