'use client';

import { useEffect, useState } from 'react';
import { alerts as alertsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  AlertTriangle, RefreshCw, CheckCircle, XCircle,
  Bell, Trash2, Filter, ShieldAlert, AlertCircle,
  Info, Check, ShieldCheck, Eye, EyeOff
} from 'lucide-react';
import { format } from 'date-fns';

const borderColors: Record<string, string> = {
  critical: '4px solid var(--accent-red)',
  error: '4px solid var(--accent-red)',
  warning: '4px solid var(--accent-amber)',
  info: '4px solid var(--accent-cyan)'
};

const iconColors: Record<string, string> = {
  critical: 'var(--accent-red)',
  error: 'var(--accent-red)',
  warning: 'var(--accent-amber)',
  info: 'var(--accent-cyan)'
};

const typeIcons: Record<string, any> = {
  printer_offline: XCircle,
  queue_overload: AlertTriangle,
  job_failed: AlertTriangle,
  client_offline: AlertTriangle,
};

const severityIcons: Record<string, any> = {
  critical: ShieldAlert,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState('');

  const fetchAlerts = async () => {
    try {
      const params: any = {};
      if (severity) params.severity = severity;

      const response = await alertsApi.list(params);
      setAlerts(response.data);
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();

    const handleNewAlert = (data: any) => {
      setAlerts(prev => [data, ...prev]);
    };

    on('alert:new', handleNewAlert);

    return () => {
      off('alert:new', handleNewAlert);
    };
  }, [severity]);

  const handleResolve = async (id: number) => {
    try {
      await alertsApi.resolve(id);
      setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_resolved: true } : a));
    } catch (error) {
      console.error('Failed to resolve alert:', error);
    }
  };

  const handleResolveAll = async () => {
    try {
      await alertsApi.resolveAll();
      setAlerts(prev => prev.map(a => ({ ...a, is_resolved: true })));
    } catch (error) {
      console.error('Failed to resolve all alerts:', error);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await alertsApi.delete(id);
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (error) {
      console.error('Failed to delete alert:', error);
    }
  };

  const unresolvedCount = alerts.filter(a => !a.is_resolved).length;
  const criticalCount = alerts.filter(a => a.severity === 'critical' && !a.is_resolved).length;
  const warningCount = alerts.filter(a => a.severity === 'warning' && !a.is_resolved).length;
  const infoCount = alerts.filter(a => (a.severity === 'info' || a.severity === 'error') && !a.is_resolved).length;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '350px', gap: '16px' }}>
        <div className="loading-spinner" />
        <span style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 600, fontSize: '14px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '2px' }}>
          Retrieving system alert logs...
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <ShieldAlert style={{ width: '28px', height: '28px', color: 'var(--accent-cyan)' }} />
            Alerts & Incidents
          </h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
            Real-time critical events and status updates from print client agents.
          </p>
        </div>
      </div>

      {/* STAT CARDS ROW */}
      <div className="stat-cards">
        {/* Total Active */}
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Total Active</span>
            <ShieldAlert className="stat-icon" style={{ color: 'var(--accent-cyan)', width: '24px', height: '24px' }} />
          </div>
          <div className="stat-value">{unresolvedCount}</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: `${unresolvedCount > 0 ? 100 : 0}%`, background: 'var(--accent-cyan)' }} />
          </div>
          <div className="stat-subtext">Active alert notifications</div>
        </div>

        {/* Critical Alerts */}
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Critical</span>
            <AlertCircle className="stat-icon" style={{ color: 'var(--accent-red)', width: '24px', height: '24px' }} />
          </div>
          <div className="stat-value" style={{ color: criticalCount > 0 ? 'var(--accent-red)' : 'var(--text-primary)' }}>{criticalCount}</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: `${unresolvedCount > 0 ? (criticalCount / unresolvedCount) * 100 : 0}%`, background: 'var(--accent-red)' }} />
          </div>
          <div className="stat-subtext">Immediate action required</div>
        </div>

        {/* Warnings */}
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Warnings</span>
            <AlertTriangle className="stat-icon" style={{ color: 'var(--accent-amber)', width: '24px', height: '24px' }} />
          </div>
          <div className="stat-value" style={{ color: warningCount > 0 ? 'var(--accent-amber)' : 'var(--text-primary)' }}>{warningCount}</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: `${unresolvedCount > 0 ? (warningCount / unresolvedCount) * 100 : 0}%`, background: 'var(--accent-amber)' }} />
          </div>
          <div className="stat-subtext">Potential issues detected</div>
        </div>

        {/* Info/Other */}
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-label">Info / Other</span>
            <Info className="stat-icon" style={{ color: 'var(--text-muted)', width: '24px', height: '24px' }} />
          </div>
          <div className="stat-value">{infoCount}</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: `${unresolvedCount > 0 ? (infoCount / unresolvedCount) * 100 : 0}%`, background: 'var(--text-muted)' }} />
          </div>
          <div className="stat-subtext">Normal status/error logs</div>
        </div>
      </div>

      {/* ALERTS TOOLBAR CARD */}
      <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', fontSize: '13px', color: 'var(--text-muted)' }}>
            Severity Filter:
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[
              { value: '', label: 'All Severities' },
              { value: 'critical', label: 'Critical' },
              { value: 'error', label: 'Error' },
              { value: 'warning', label: 'Warning' },
              { value: 'info', label: 'Info' }
            ].map(item => (
              <button
                key={item.value}
                onClick={() => setSeverity(item.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'Rajdhani, sans-serif',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: severity === item.value ? 'rgba(0, 212, 255, 0.15)' : 'transparent',
                  color: severity === item.value ? 'var(--accent-cyan)' : 'var(--text-primary)',
                  borderColor: severity === item.value ? 'var(--accent-cyan)' : 'var(--border)',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {item.value === 'critical' && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-red)' }} />}
                {item.value === 'error' && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-red)' }} />}
                {item.value === 'warning' && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-amber)' }} />}
                {item.value === 'info' && <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent-cyan)' }} />}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={fetchAlerts}
            className="btn-primary"
            style={{
              fontSize: '13px',
              padding: '8px 16px',
              borderRadius: '8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <RefreshCw style={{ width: '14px', height: '14px' }} />
            Refresh
          </button>
          {unresolvedCount > 0 && (
            <button
              onClick={handleResolveAll}
              className="btn-primary"
              style={{
                fontSize: '13px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, rgba(0, 255, 136, 0.15) 0%, rgba(0, 212, 255, 0.15) 100%)',
                borderColor: 'var(--accent-green)',
                color: 'var(--accent-green)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <ShieldCheck style={{ width: '14px', height: '14px' }} />
              Resolve All
            </button>
          )}
        </div>
      </div>

      {/* ALERT ITEMS / TIMELINE */}
      {alerts.length === 0 ? (
        /* BETTER EMPTY STATE */
        <div className="card" style={{ padding: '64px 32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(0, 255, 136, 0.1)',
            border: '1px solid rgba(0, 255, 136, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-green)',
            boxShadow: 'var(--glow-green)',
            marginBottom: '8px'
          }}>
            <ShieldCheck style={{ width: '40px', height: '40px' }} />
          </div>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700, fontFamily: 'Rajdhani, sans-serif', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-primary)' }}>
            All Systems Operational
          </h3>
          <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-muted)', maxWidth: '400px', lineHeight: 1.5 }}>
            No active alerts found. Your print servers, client connections, and print queues are running smoothly.
          </p>
          <button
            onClick={fetchAlerts}
            className="btn-primary"
            style={{ marginTop: '8px' }}
          >
            <RefreshCw style={{ width: '14px', height: '14px' }} />
            Check Again
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {alerts.map((alert) => {
            const TypeIcon = typeIcons[alert.type] || severityIcons[alert.severity] || AlertTriangle;
            return (
              <div
                key={alert.id}
                className="card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px',
                  borderLeft: borderColors[alert.severity] || '4px solid var(--border)',
                  opacity: alert.is_resolved ? 0.6 : 1,
                  boxShadow: !alert.is_resolved ? '0 0 10px rgba(0, 212, 255, 0.05)' : 'none',
                  background: alert.is_resolved ? 'var(--bg-secondary)' : 'var(--bg-card)',
                  transition: 'all 0.2s ease',
                  flexWrap: 'wrap'
                }}
              >
                {/* Rich Icon Container */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: alert.is_resolved ? 'rgba(255, 255, 255, 0.05)' : (
                    alert.severity === 'critical' || alert.severity === 'error' ? 'rgba(255, 61, 90, 0.1)' :
                    alert.severity === 'warning' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(0, 212, 255, 0.1)'
                  ),
                  color: alert.is_resolved ? 'var(--text-muted)' : (iconColors[alert.severity] || 'var(--accent-cyan)'),
                  flexShrink: 0
                }}>
                  <TypeIcon style={{ width: '20px', height: '20px' }} />
                </div>

                {/* Info/Message Area */}
                <div style={{ flex: 1, minWidth: '240px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '15px',
                      fontWeight: 600,
                      fontFamily: 'Rajdhani, sans-serif',
                      color: 'var(--text-primary)',
                      textDecoration: alert.is_resolved ? 'line-through' : 'none'
                    }}>
                      {alert.title}
                    </h3>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontFamily: 'Share Tech Mono, monospace',
                      textTransform: 'uppercase',
                      fontWeight: 'bold',
                      background: alert.severity === 'critical' || alert.severity === 'error' ? 'rgba(255, 61, 90, 0.15)' :
                                  alert.severity === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(0, 212, 255, 0.15)',
                      color: alert.severity === 'critical' || alert.severity === 'error' ? 'var(--accent-red)' :
                             alert.severity === 'warning' ? 'var(--accent-amber)' : 'var(--accent-cyan)',
                      border: alert.severity === 'critical' || alert.severity === 'error' ? '1px solid rgba(255, 61, 90, 0.3)' :
                              alert.severity === 'warning' ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(0, 212, 255, 0.3)'
                    }}>
                      {alert.severity}
                    </span>
                    {alert.is_resolved && (
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontFamily: 'Share Tech Mono, monospace',
                        textTransform: 'uppercase',
                        fontWeight: 'bold',
                        background: 'rgba(0, 255, 136, 0.15)',
                        color: 'var(--accent-green)',
                        border: '1px solid rgba(0, 255, 136, 0.3)'
                      }}>
                        Resolved
                      </span>
                    )}
                    {!alert.is_resolved && (
                      <span style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: alert.severity === 'critical' || alert.severity === 'error' ? 'var(--accent-red)' : 'var(--accent-cyan)',
                        boxShadow: alert.severity === 'critical' || alert.severity === 'error' ? '0 0 8px var(--accent-red)' : '0 0 8px var(--accent-cyan)',
                        animation: 'network-pulse 2s ease-in-out infinite'
                      }} />
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
                    {alert.message}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '6px', fontSize: '11px', fontFamily: 'Share Tech Mono, monospace', color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                    <span>{format(new Date(alert.created_at), 'yyyy-MM-dd HH:mm:ss')}</span>
                    {alert.client_name && <span>Client: <strong style={{ color: 'var(--text-muted)' }}>{alert.client_name}</strong></span>}
                    {alert.printer_name && <span>Printer: <strong style={{ color: 'var(--text-muted)' }}>{alert.printer_name}</strong></span>}
                  </div>
                </div>

                {/* Quick Actions Container */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                  {!alert.is_resolved && (
                    <button
                      onClick={() => handleResolve(alert.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '32px',
                        height: '32px',
                        borderRadius: '6px',
                        border: '1px solid rgba(0, 255, 136, 0.3)',
                        background: 'rgba(0, 255, 136, 0.05)',
                        color: 'var(--accent-green)',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      title="Mark as Resolved"
                    >
                      <Check style={{ width: '16px', height: '16px' }} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(alert.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255, 61, 90, 0.3)',
                      background: 'rgba(255, 61, 90, 0.05)',
                      color: 'var(--accent-red)',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                    title="Delete Alert"
                  >
                    <Trash2 style={{ width: '16px', height: '16px' }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}