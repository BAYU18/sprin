'use client';

import { useEffect, useState } from 'react';
import { alerts as alertsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  AlertTriangle, RefreshCw, CheckCircle, XCircle,
  Bell, Trash2, Filter
} from 'lucide-react';
import { format } from 'date-fns';

const severityColors: Record<string, string> = {
  info: 'badge-info',
  warning: 'badge-warning',
  error: 'badge-error',
  critical: 'bg-red-500/30 text-red-400 border border-red-500/50'
};

const typeIcons: Record<string, any> = {
  printer_offline: XCircle,
  queue_overload: AlertTriangle,
  job_failed: AlertTriangle,
  client_offline: AlertTriangle,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Alerts</h1>
          {unresolvedCount > 0 && (
            <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded-full text-sm">
              {unresolvedCount} unresolved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="input w-auto"
          >
            <option value="">All Severity</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
            <option value="critical">Critical</option>
          </select>
          <button onClick={fetchAlerts} className="btn-primary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {unresolvedCount > 0 && (
            <button onClick={handleResolveAll} className="btn-primary flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />
              Resolve All
            </button>
          )}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="card text-center py-12">
          <Bell className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Alerts</h3>
          <p className="text-slate-400">All systems are running normally</p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => {
            const TypeIcon = typeIcons[alert.type] || AlertTriangle;
            return (
              <div
                key={alert.id}
                className={`card flex items-start gap-4 ${
                  alert.is_resolved ? 'opacity-60' : ''
                } ${alert.severity === 'critical' ? 'border-red-500/50' : ''}`}
              >
                <div className={`p-2 rounded-lg ${
                  alert.severity === 'critical' ? 'bg-red-500/20' :
                  alert.severity === 'error' ? 'bg-red-500/20' :
                  alert.severity === 'warning' ? 'bg-yellow-500/20' :
                  'bg-blue-500/20'
                }`}>
                  <TypeIcon className={`w-5 h-5 ${
                    alert.severity === 'critical' || alert.severity === 'error' ? 'text-red-500' :
                    alert.severity === 'warning' ? 'text-yellow-500' :
                    'text-blue-500'
                  }`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">{alert.title}</h3>
                    <span className={`badge ${severityColors[alert.severity] || 'badge-info'}`}>
                      {alert.severity}
                    </span>
                    {alert.is_resolved && (
                      <span className="badge bg-green-500/20 text-green-400">Resolved</span>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm">{alert.message}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                    <span>{format(new Date(alert.created_at), 'MM/dd HH:mm:ss')}</span>
                    {alert.client_name && <span>Client: {alert.client_name}</span>}
                    {alert.printer_name && <span>Printer: {alert.printer_name}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!alert.is_resolved && (
                    <button
                      onClick={() => handleResolve(alert.id)}
                      className="p-2 hover:bg-green-500/20 text-green-400 rounded"
                      title="Resolve"
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(alert.id)}
                    className="p-2 hover:bg-red-500/20 text-red-400 rounded"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
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