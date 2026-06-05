'use client';

import { useEffect, useState } from 'react';
import { clients as clientsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  Monitor, RefreshCw, Plus, Trash2, Server, Wifi, WifiOff
} from 'lucide-react';
import { format } from 'date-fns';

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClients = async () => {
    try {
      const response = await clientsApi.list();
      setClients(response.data);
    } catch (error) {
      console.error('Failed to fetch clients:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();

    const handleClientUpdate = (data: any) => {
      setClients(prev => prev.map(c => c.id === data.clientId ? { ...c, is_online: true } : c));
    };

    const handleClientOnline = (data: any) => {
      setClients(prev => prev.map(c => c.id === data.clientId ? { ...c, is_online: true } : c));
    };

    const handleClientOffline = (data: any) => {
      setClients(prev => prev.map(c => c.id === data.clientId ? { ...c, is_online: false } : c));
    };

    on('client:heartbeat', handleClientUpdate);
    on('client:online', handleClientOnline);
    on('client:offline', handleClientOffline);

    return () => {
      off('client:heartbeat', handleClientUpdate);
      off('client:online', handleClientOnline);
      off('client:offline', handleClientOffline);
    };
  }, []);

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this client?')) {
      try {
        await clientsApi.delete(id);
        setClients(prev => prev.filter(c => c.id !== id));
      } catch (error) {
        console.error('Failed to delete client:', error);
      }
    }
  };

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
        <h1 className="text-2xl font-bold">Clients</h1>
        <button onClick={fetchClients} className="btn-primary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="card text-center py-12">
          <Monitor className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Clients</h3>
          <p className="text-slate-400">Install PrintServer Client on target machines</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => (
            <div key={client.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${client.is_online ? 'bg-green-500/20' : 'bg-slate-700'}`}>
                    {client.is_online ? (
                      <Wifi className="w-5 h-5 text-green-500" />
                    ) : (
                      <WifiOff className="w-5 h-5 text-slate-500" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">{client.hostname}</h3>
                    <p className="text-sm text-slate-400">{client.ip_address || 'No IP'}</p>
                  </div>
                </div>
                <div className={`px-2 py-1 rounded text-xs ${
                  client.is_online ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                }`}>
                  {client.is_online ? 'Online' : 'Offline'}
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">OS Version</span>
                  <span>{client.os_version || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Client Version</span>
                  <span>{client.client_version || '1.0.0'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Last Seen</span>
                  <span>{client.last_seen ? format(new Date(client.last_seen), 'MM/dd HH:mm') : 'Never'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">MAC Address</span>
                  <span className="font-mono text-xs">{client.mac_address || 'N/A'}</span>
                </div>
              </div>

              {client.metadata?.printers?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-700">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-400 text-sm">Printers ({client.metadata.printers.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {client.metadata.printers.slice(0, 8).map((printer: any, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                        {typeof printer === 'string' ? printer : printer?.name || 'Unknown'}
                      </span>
                    ))}
                    {client.metadata.printers.length > 8 && (
                      <span className="px-2 py-1 bg-slate-700 text-slate-400 rounded text-xs">
                        +{client.metadata.printers.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-slate-700 flex justify-end">
                <button
                  onClick={() => handleDelete(client.id)}
                  className="p-2 hover:bg-red-500/20 text-red-400 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}