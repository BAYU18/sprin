'use client';

import { useEffect, useState } from 'react';
import { printers as printersApi, jobs as jobsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  Printer, Plus, RefreshCw, CheckCircle, XCircle,
  AlertTriangle, MoreVertical, Trash2, Edit
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

export default function PrintersPage() {
  const [printers, setPrinters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPrinters = async () => {
    try {
      const response = await printersApi.list();
      setPrinters(response.data);
    } catch (error) {
      console.error('Failed to fetch printers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrinters();

    const handlePrinterUpdate = () => fetchPrinters();
    on('printer:update', handlePrinterUpdate);
    on('printer:created', handlePrinterUpdate);

    return () => {
      off('printer:update', handlePrinterUpdate);
      off('printer:created', handlePrinterUpdate);
    };
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'busy': return 'bg-yellow-500';
      case 'offline': return 'bg-red-500';
      default: return 'bg-slate-500';
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
        <h1 className="text-2xl font-bold">Printers</h1>
        <div className="flex items-center gap-2">
          <button onClick={fetchPrinters} className="btn-primary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Printer
          </button>
        </div>
      </div>

      {printers.length === 0 ? (
        <div className="card text-center py-12">
          <Printer className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Printers</h3>
          <p className="text-slate-400 mb-4">Add your first printer to get started</p>
          <button className="btn-primary inline-flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add Printer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {printers.map((printer) => (
            <div key={printer.id} className="card hover:border-slate-600 transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${getStatusColor(printer.status)}`} />
                  <div>
                    <h3 className="font-semibold">{printer.name}</h3>
                    <p className="text-sm text-slate-400">{printer.type}</p>
                  </div>
                </div>
                <button className="p-1 hover:bg-slate-700 rounded">
                  <MoreVertical className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Driver</span>
                  <span>{printer.driver || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Port</span>
                  <span className="truncate max-w-[150px]">{printer.port || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Status</span>
                  <span className="capitalize">{printer.status || 'unknown'}</span>
                </div>
                {printer.group_name && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Group</span>
                    <span>{printer.group_name}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-700 flex gap-2">
                <Link
                  href={`/printers/${printer.id}`}
                  className="flex-1 btn-primary text-center text-sm py-2"
                >
                  View Jobs
                </Link>
                <button className="p-2 hover:bg-slate-700 rounded">
                  <Edit className="w-4 h-4" />
                </button>
                <button className="p-2 hover:bg-red-500/20 text-red-400 rounded">
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