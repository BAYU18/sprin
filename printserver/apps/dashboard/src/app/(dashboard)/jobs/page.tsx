'use client';

import { useEffect, useState } from 'react';
import { jobs as jobsApi } from '@/lib/api';
import { on, off } from '@/hooks/useSocket';
import {
  FileText, RefreshCw, Search, Filter, Download,
  XCircle, RotateCcw, Clock, CheckCircle, Loader2
} from 'lucide-react';
import { format } from 'date-fns';

const statusIcons: Record<string, any> = {
  queued: Clock,
  processing: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: XCircle
};

const statusColors: Record<string, string> = {
  queued: 'badge-warning',
  processing: 'badge-info',
  completed: 'badge-success',
  failed: 'badge-error',
  cancelled: 'badge-error'
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 20 };
      if (status) params.status = status;
      if (search) params.search = search;

      const response = await jobsApi.list(params);
      setJobs(response.data.jobs);
      setTotal(response.data.total);
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [page, status]);

  useEffect(() => {
    const handleJobUpdate = () => fetchJobs();
    on('job:new', handleJobUpdate);
    on('job:complete', handleJobUpdate);
    on('job:error', handleJobUpdate);

    return () => {
      off('job:new', handleJobUpdate);
      off('job:complete', handleJobUpdate);
      off('job:error', handleJobUpdate);
    };
  }, [page, status]);

  const handleRetry = async (jobId: string) => {
    try {
      await jobsApi.retry(jobId);
      fetchJobs();
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  };

  const handleCancel = async (jobId: string) => {
    try {
      await jobsApi.cancel(jobId);
      fetchJobs();
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  const handleExport = async () => {
    window.open(`${process.env.NEXT_PUBLIC_API_URL}/api/jobs/export/csv`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Print Jobs</h1>
        <button onClick={handleExport} className="btn-primary flex items-center gap-2">
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      <div className="card">
        <div className="flex flex-wrap gap-4 mb-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search jobs..."
                className="input pl-10"
              />
            </div>
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="input w-auto"
          >
            <option value="">All Status</option>
            <option value="queued">Queued</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={fetchJobs} className="btn-primary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="pb-3 font-medium">Job ID</th>
                <th className="pb-3 font-medium">File Name</th>
                <th className="pb-3 font-medium">User</th>
                <th className="pb-3 font-medium">Printer</th>
                <th className="pb-3 font-medium">Pages</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Created</th>
                <th className="pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No jobs found
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const StatusIcon = statusIcons[job.status] || Clock;
                  return (
                    <tr key={job.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                      <td className="py-3 font-mono text-sm">{job.job_id?.slice(0, 8)}</td>
                      <td className="py-3 max-w-[200px] truncate">{job.file_name || job.job_name}</td>
                      <td className="py-3">{job.username || 'Unknown'}</td>
                      <td className="py-3">{job.printer_name || 'N/A'}</td>
                      <td className="py-3">{job.pages * job.copies}</td>
                      <td className="py-3">
                        <span className={`badge ${statusColors[job.status] || 'badge-info'}`}>
                          <StatusIcon className={`w-3 h-3 mr-1 ${job.status === 'processing' ? 'animate-spin' : ''}`} />
                          {job.status}
                        </span>
                      </td>
                      <td className="py-3 text-slate-400 text-sm">
                        {format(new Date(job.created_at), 'MM/dd HH:mm')}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          {job.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(job.job_id)}
                              className="p-2 hover:bg-blue-500/20 text-blue-400 rounded"
                              title="Retry"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          {['queued', 'processing'].includes(job.status) && (
                            <button
                              onClick={() => handleCancel(job.job_id)}
                              className="p-2 hover:bg-red-500/20 text-red-400 rounded"
                              title="Cancel"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-700">
          <p className="text-slate-400 text-sm">
            Showing {jobs.length} of {total} jobs
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-slate-400 text-sm">
              Page {page} of {Math.ceil(total / 20) || 1}
            </span>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= Math.ceil(total / 20)}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}