'use client';

import { useEffect, useState } from 'react';
import { analytics, jobs as jobsApi, printers, clients } from '@/lib/api';
import { on } from '@/hooks/useSocket';
import {
  Printer, Monitor, FileText, AlertTriangle, CheckCircle,
  Clock, TrendingUp, RefreshCw, Activity
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar
} from 'recharts';

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [todayStats, setTodayStats] = useState<any>(null);
  const [volumeData, setVolumeData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [overviewRes, todayRes, volumeRes] = await Promise.all([
        analytics.overview(),
        jobsApi.stats.today(),
        analytics.volume(7)
      ]);
      setStats(overviewRes.data);
      setTodayStats(todayRes.data);
      setVolumeData(volumeRes.data || []);
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);

    const handleJobUpdate = (data: any) => {
      fetchData();
    };

    on('job:new', handleJobUpdate);
    on('job:complete', handleJobUpdate);

    return () => {
      clearInterval(interval);
      off('job:new', handleJobUpdate);
      off('job:complete', handleJobUpdate);
    };
  }, []);

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
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button onClick={fetchData} className="btn-primary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Printer className="text-blue-500" />}
          label="Total Printers"
          value={stats?.printers?.total || 0}
          subtext={`${stats?.printers?.online || 0} online`}
          trend={stats?.printers?.online ? 'up' : undefined}
        />
        <StatCard
          icon={<Monitor className="text-green-500" />}
          label="Active Clients"
          value={stats?.clients?.online || 0}
          subtext={`of ${stats?.clients?.total || 0} total`}
        />
        <StatCard
          icon={<FileText className="text-purple-500" />}
          label="Today's Jobs"
          value={todayStats?.total || 0}
          subtext={`${todayStats?.completed || 0} completed`}
        />
        <StatCard
          icon={<AlertTriangle className="text-yellow-500" />}
          label="Pending Queue"
          value={stats?.jobs?.pending || 0}
          subtext="in queue"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Print Volume (7 Days)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="jobs"
                  stroke="#3b82f6"
                  fill="#3b82f6"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Pages Printed (7 Days)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis
                  dataKey="date"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '8px'
                  }}
                />
                <Bar dataKey="pages" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-4">Quick Stats</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <span>Completed Today</span>
              </div>
              <span className="font-bold">{todayStats?.completed || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <div className="flex items-center gap-3">
                <XCircle className="w-5 h-5 text-red-500" />
                <span>Failed Today</span>
              </div>
              <span className="font-bold">{todayStats?.failed || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <div className="flex items-center gap-3">
                <Activity className="w-5 h-5 text-blue-500" />
                <span>Processing</span>
              </div>
              <span className="font-bold">{todayStats?.processing || 0}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-purple-500" />
                <span>Total Pages</span>
              </div>
              <span className="font-bold">{todayStats?.total_pages || 0}</span>
            </div>
          </div>
        </div>

        <div className="card lg:col-span-2">
          <h3 className="text-lg font-semibold mb-4">Printer Status</h3>
          <div className="space-y-3">
            {(stats?.printers?.total || 0) === 0 ? (
              <p className="text-slate-400 text-center py-8">No printers configured</p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span>Online Printers</span>
                  </div>
                  <span className="font-bold">{stats?.printers?.online || 0}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <span>Offline Printers</span>
                  </div>
                  <span className="font-bold">{(stats?.printers?.total || 0) - (stats?.printers?.online || 0)}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Clock className="w-5 h-5 text-yellow-500" />
                    <span>Pending Jobs</span>
                  </div>
                  <span className="font-bold">{stats?.jobs?.pending || 0}</span>
                </div>
              </div>
            )}
          </div>
          <Link href="/printers" className="btn-primary mt-4 inline-block">
            Manage Printers
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, subtext, trend }: any) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-slate-700 rounded-lg">{icon}</div>
        <span className="text-slate-400 text-sm">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold">{value}</span>
        {subtext && <span className="text-slate-500 text-sm">{subtext}</span>}
      </div>
    </div>
  );
}