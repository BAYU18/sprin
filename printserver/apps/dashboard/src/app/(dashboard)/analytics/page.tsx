'use client';

import { useEffect, useState } from 'react';
import { analytics as analyticsApi } from '@/lib/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie
} from 'recharts';
import {
  FileText,
  Printer,
  Users,
  RefreshCw,
  BarChart2,
  PieChart as PieIcon,
  Award,
  AlertTriangle,
  TrendingUp,
  ShieldAlert
} from 'lucide-react';
import { format } from 'date-fns';

const DARK_COLORS = ['#00d4ff', '#00ff88', '#f59e0b', '#a855f7', '#ff3d5a'];

export default function AnalyticsPage() {
  const [volumeData, setVolumeData] = useState<any[]>([]);
  const [printerUsage, setPrinterUsage] = useState<any[]>([]);
  const [topUsers, setTopUsers] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [paperUsage, setPaperUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [volumeRes, printersRes, usersRes, deptRes, paperRes] = await Promise.all([
        analyticsApi.volume(30),
        analyticsApi.printersUsage(),
        analyticsApi.topUsers(10),
        analyticsApi.departments(),
        analyticsApi.paperUsage()
      ]);
      setVolumeData(volumeRes.data || []);
      setPrinterUsage(printersRes.data || []);
      setTopUsers(usersRes.data || []);
      setDepartments(deptRes.data || []);
      setPaperUsage(paperRes.data || []);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="loading-state" style={{ height: '350px' }}>
        <div className="loading-spinner" />
        <div style={{ fontFamily: 'Rajdhani', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '1px' }}>
          LOADING METRICS...
        </div>
      </div>
    );
  }

  // Calculate stats
  const totalJobs = volumeData.reduce((sum, item) => sum + Number(item.jobs || 0), 0);
  const totalPages = volumeData.reduce((sum, item) => sum + Number(item.pages || 0), 0);

  // Top printer
  const topPrinter = printerUsage.length > 0 
    ? printerUsage.reduce((max, item) => (Number(item.pages || 0) > Number(max.pages || 0) ? item : max), printerUsage[0])
    : null;
  const topPrinterName = topPrinter ? topPrinter.name : 'N/A';
  const topPrinterCount = topPrinter ? Number(topPrinter.pages || 0) : 0;

  // Active Users count
  const activeUsersCount = topUsers.length;

  // Total Departments
  const totalDepartments = departments.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Title + Action bar */}
      <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <BarChart2 style={{ color: 'var(--accent-cyan)', width: '28px', height: '28px' }} />
          <h1 style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'Rajdhani', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
            Analytics
          </h1>
        </div>
        <button onClick={fetchData} className="btn-primary" style={{ cursor: 'pointer' }}>
          <RefreshCw style={{ width: '16px', height: '16px' }} />
          Refresh
        </button>
      </div>
      {/* Mobile title (more compact) */}
      <div className="mobile-only" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BarChart2 style={{ color: 'var(--accent-cyan)', width: '22px', height: '22px' }} />
          <h1 style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'Rajdhani', textTransform: 'uppercase', letterSpacing: '1px', margin: 0 }}>
            Analytics
          </h1>
        </div>
      </div>

      {/* Stat cards row */}
      <div className="stat-cards">
        {/* Total Print Volume Card */}
        <div className="stat-card">
          <div className="stat-card-header">
            <FileText className="stat-icon" style={{ color: 'var(--accent-cyan)' }} />
            <span className="stat-badge cyan">Volume</span>
          </div>
          <div className="stat-value">{totalPages.toLocaleString()}</div>
          <div className="stat-label">Total Print Volume</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: '100%' }} />
          </div>
          <div className="stat-subtext">
            Processed <span>{totalJobs.toLocaleString()}</span> jobs in 30d
          </div>
        </div>

        {/* Top Printer Card */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Printer className="stat-icon" style={{ color: 'var(--accent-green)' }} />
            <span className="stat-badge green">Printer</span>
          </div>
          <div className="stat-value" style={{ fontSize: '32px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {topPrinterCount.toLocaleString()}
          </div>
          <div className="stat-label">Top Printer (Pages)</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: '100%', background: 'linear-gradient(90deg, var(--accent-green), var(--accent-cyan))' }} />
          </div>
          <div className="stat-subtext" style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            Device: <span>{topPrinterName}</span>
          </div>
        </div>

        {/* Active Users Card */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Users className="stat-icon" style={{ color: 'var(--accent-cyan)' }} />
            <span className="stat-badge cyan">Users</span>
          </div>
          <div className="stat-value">{activeUsersCount}</div>
          <div className="stat-label">Active Users</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: '100%', background: 'linear-gradient(90deg, var(--accent-cyan), var(--accent-amber))' }} />
          </div>
          <div className="stat-subtext">
            Active printing users
          </div>
        </div>

        {/* Total Departments Card */}
        <div className="stat-card">
          <div className="stat-card-header">
            <Award className="stat-icon" style={{ color: 'var(--accent-amber)' }} />
            <span className="stat-badge amber">Depts</span>
          </div>
          <div className="stat-value">{totalDepartments}</div>
          <div className="stat-label">Total Departments</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: '100%', background: 'linear-gradient(90deg, var(--accent-amber), var(--accent-red))' }} />
          </div>
          <div className="stat-subtext">
            Cost center units
          </div>
        </div>
      </div>

      {/* Charts container */}
      <div className="grid-2col">
        {/* Card 1: Print Volume (30 Days) */}
        <div className="chart-card" style={{ '--index': 0 } as React.CSSProperties}>
          <div className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileText style={{ width: '18px', height: '18px', color: 'var(--accent-cyan)' }} />
            <span>Print Volume (30 Days)</span>
          </div>
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volumeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="volumeCyan" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#00d4ff" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickFormatter={(value) => format(new Date(value), 'MM/dd')}
                  dy={10}
                />
                <YAxis stroke="var(--text-muted)" fontSize={11} dx={-5} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    boxShadow: 'var(--shadow-hover)'
                  }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  labelStyle={{ color: 'var(--text-muted)', fontFamily: 'Rajdhani', fontWeight: 600 }}
                  labelFormatter={(value) => format(new Date(value), 'yyyy-MM-dd')}
                />
                <Bar dataKey="jobs" fill="url(#volumeCyan)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Card 2: Top Printers by Usage */}
        <div className="chart-card" style={{ '--index': 1 } as React.CSSProperties}>
          <div className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Printer style={{ width: '18px', height: '18px', color: 'var(--accent-green)' }} />
            <span>Top Printers by Usage</span>
          </div>
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={printerUsage.slice(0, 5)} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="usageGreen" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#00ff88" stopOpacity={0.1} />
                    <stop offset="100%" stopColor="#00ff88" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                <XAxis type="number" stroke="var(--text-muted)" fontSize={11} dy={5} />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="var(--text-muted)"
                  fontSize={11}
                  width={120}
                  tickFormatter={(value) => value.length > 18 ? value.slice(0, 18) + '...' : value}
                  dx={-5}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--bg-secondary)',
                    borderColor: 'var(--border)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    boxShadow: 'var(--shadow-hover)'
                  }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  labelStyle={{ color: 'var(--text-muted)', fontFamily: 'Rajdhani', fontWeight: 600 }}
                />
                <Bar dataKey="pages" fill="url(#usageGreen)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Ranked tables row */}
      <div className="grid-2col">
        {/* Top Users Table Card */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
            <Award style={{ width: '18px', height: '18px', color: 'var(--accent-cyan)' }} />
            <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Rajdhani', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', margin: 0 }}>
              Top Users
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {topUsers.slice(0, 5).map((user, index) => {
              const maxUserPages = Math.max(...topUsers.map(u => Number(u.pages || 0)), 1);
              const percentage = Math.min(((Number(user.pages || 0)) / maxUserPages) * 100, 100);
              
              let badgeColor = 'var(--text-muted)';
              let badgeBg = 'rgba(74, 96, 128, 0.1)';
              let badgeBorder = '1px solid var(--border)';
              if (index === 0) {
                badgeColor = 'var(--accent-cyan)';
                badgeBg = 'rgba(0, 212, 255, 0.1)';
                badgeBorder = '1px solid rgba(0, 212, 255, 0.3)';
              } else if (index === 1) {
                badgeColor = 'var(--accent-green)';
                badgeBg = 'rgba(0, 255, 136, 0.1)';
                badgeBorder = '1px solid rgba(0, 255, 136, 0.3)';
              } else if (index === 2) {
                badgeColor = 'var(--accent-amber)';
                badgeBg = 'rgba(245, 158, 11, 0.1)';
                badgeBorder = '1px solid rgba(245, 158, 11, 0.3)';
              }

              return (
                <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '50%', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '13px', 
                    fontWeight: 700,
                    fontFamily: 'Share Tech Mono',
                    color: badgeColor,
                    backgroundColor: badgeBg,
                    border: badgeBorder
                  }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {user.full_name || user.username}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>
                          {user.department || 'No Department'}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontFamily: 'Share Tech Mono', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {Number(user.pages || 0).toLocaleString()}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>pgs</span>
                      </div>
                    </div>
                    <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ 
                        width: `${percentage}%`, 
                        height: '100%', 
                        background: index === 0 
                          ? 'linear-gradient(90deg, var(--accent-cyan), var(--accent-green))' 
                          : index === 1
                          ? 'linear-gradient(90deg, var(--accent-green), var(--accent-amber))'
                          : 'linear-gradient(90deg, var(--accent-cyan), var(--text-muted))', 
                        borderRadius: '3px',
                        transition: 'width 1s ease-out'
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {topUsers.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontFamily: 'Share Tech Mono' }}>
                No user analytics available
              </div>
            )}
          </div>
        </div>

        {/* Departments Ranking Table Card */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
            <TrendingUp style={{ width: '18px', height: '18px', color: 'var(--accent-amber)' }} />
            <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Rajdhani', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', margin: 0 }}>
              Departments
            </h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {departments.slice(0, 5).map((dept, index) => {
              const maxDeptPages = Math.max(...departments.map(d => Number(d.pages || 0)), 1);
              const percentage = Math.min(((Number(dept.pages || 0)) / maxDeptPages) * 100, 100);

              let badgeColor = 'var(--text-muted)';
              let badgeBg = 'rgba(74, 96, 128, 0.1)';
              let badgeBorder = '1px solid var(--border)';
              if (index === 0) {
                badgeColor = 'var(--accent-amber)';
                badgeBg = 'rgba(245, 158, 11, 0.1)';
                badgeBorder = '1px solid rgba(245, 158, 11, 0.3)';
              } else if (index === 1) {
                badgeColor = 'var(--accent-cyan)';
                badgeBg = 'rgba(0, 212, 255, 0.1)';
                badgeBorder = '1px solid rgba(0, 212, 255, 0.3)';
              } else if (index === 2) {
                badgeColor = 'var(--accent-green)';
                badgeBg = 'rgba(0, 255, 136, 0.1)';
                badgeBorder = '1px solid rgba(0, 255, 136, 0.3)';
              }

              return (
                <div key={dept.department} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ 
                    width: '32px', 
                    height: '32px', 
                    borderRadius: '50%', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    fontSize: '13px', 
                    fontWeight: 700,
                    fontFamily: 'Share Tech Mono',
                    color: badgeColor,
                    backgroundColor: badgeBg,
                    border: badgeBorder
                  }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {dept.department}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>
                          {dept.jobs || 0} jobs processed
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontFamily: 'Share Tech Mono', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {Number(dept.pages || 0).toLocaleString()}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>pgs</span>
                      </div>
                    </div>
                    <div style={{ width: '100%', height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ 
                        width: `${percentage}%`, 
                        height: '100%', 
                        background: index === 0 
                          ? 'linear-gradient(90deg, var(--accent-amber), var(--accent-red))' 
                          : index === 1
                          ? 'linear-gradient(90deg, var(--accent-cyan), var(--accent-green))'
                          : 'linear-gradient(90deg, var(--accent-green), var(--text-muted))', 
                        borderRadius: '3px',
                        transition: 'width 1s ease-out'
                      }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {departments.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontFamily: 'Share Tech Mono' }}>
                No department data available
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pie Chart & Failure Analysis Row */}
      <div className="grid-2col-asym">
        {/* Paper Usage PieChart */}
        <div className="chart-card" style={{ '--index': 2 } as React.CSSProperties}>
          <div className="chart-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <PieIcon style={{ width: '18px', height: '18px', color: 'var(--accent-cyan)' }} />
            <span>Paper Size Distribution</span>
          </div>
          <div style={{ height: '260px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paperUsage.length > 0 ? paperUsage : [{ paper_size: 'A4', total_pages: 1 }]}
                  dataKey="total_pages"
                  nameKey="paper_size"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={45}
                  paddingAngle={3}
                  label={({ paper_size, percent }) =>
                    `${paper_size} (${(percent * 100).toFixed(0)}%)`
                  }
                  labelLine={false}
                  style={{ fontSize: '10px', fill: 'var(--text-primary)', fontFamily: 'Rajdhani', fontWeight: 600 }}
                >
                  {(paperUsage.length > 0 ? paperUsage : [{ paper_size: 'A4', total_pages: 1 }]).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={DARK_COLORS[index % DARK_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  formatter={(value: number, name: string) => [value, `${name} Pages`]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* TIER-2 #5: scrollable legend (always visible, since pie labels overflow on small screens) */}
          {paperUsage.length > 0 && (
            <div className="scroll-x" style={{
              display: 'flex', gap: '12px', flexWrap: 'nowrap',
              marginTop: '8px', paddingBottom: '4px',
            }}>
              {paperUsage.map((entry, index) => (
                <div key={index} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0,
                  fontFamily: 'Share Tech Mono',
                }}>
                  <span style={{
                    width: '10px', height: '10px', borderRadius: '2px',
                    background: DARK_COLORS[index % DARK_COLORS.length],
                  }} />
                  {entry.paper_size} • {Number(entry.total_pages || 0).toLocaleString()}pgs
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Print Failure Analysis (using departments placeholder) */}
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', paddingBottom: '12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert style={{ width: '18px', height: '18px', color: 'var(--accent-red)' }} />
              <h3 style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'Rajdhani', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', margin: 0 }}>
                Print Failure Analysis
              </h3>
            </div>
            <span style={{ 
              fontSize: '10px', 
              fontWeight: 700, 
              color: 'var(--accent-red)', 
              backgroundColor: 'rgba(255, 61, 90, 0.1)', 
              padding: '3px 8px', 
              borderRadius: '10px', 
              border: '1px solid rgba(255, 61, 90, 0.3)',
              fontFamily: 'Rajdhani',
              textTransform: 'uppercase',
              letterSpacing: '1px'
            }}>
              Monitoring Active
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ paddingBottom: '12px', fontWeight: 600, fontFamily: 'Rajdhani', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px' }}>
                    Error Message / Cost Center
                  </th>
                  <th style={{ paddingBottom: '12px', fontWeight: 600, fontFamily: 'Rajdhani', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '1px', textAlign: 'right' }}>
                    Failed Count
                  </th>
                </tr>
              </thead>
              <tbody>
                {departments.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'Share Tech Mono' }}>
                      No failure data available
                    </td>
                  </tr>
                ) : (
                  departments.map((dept, index) => (
                    <tr key={index} style={{ borderBottom: '1px solid rgba(30, 48, 80, 0.3)' }}>
                      <td style={{ padding: '12px 0', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <AlertTriangle style={{ width: '14px', height: '14px', color: 'var(--accent-amber)', flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>
                            {dept.department}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 0', textAlign: 'right', fontFamily: 'Share Tech Mono', color: 'var(--accent-red)', fontWeight: 600, fontSize: '13px', verticalAlign: 'middle' }}>
                        {dept.pages} pages
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Mobile bottom action bar (Refresh) ──────────────────── */}
      <div className="mobile-action-bar" style={{ paddingBottom: 'calc(10px + env(safe-area-inset-bottom))' }}>
        <button onClick={fetchData} style={{ minHeight: '48px' }}>
          <RefreshCw size={16} /> Refresh Analytics
        </button>
      </div>
    </div>
  );
}
