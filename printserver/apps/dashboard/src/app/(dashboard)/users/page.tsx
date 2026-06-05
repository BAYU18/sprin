'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '@/lib/api';
import { Plus, RefreshCw, Edit, Trash2, User, Shield, UserPlus, Check, Clock } from 'lucide-react';
import { format } from 'date-fns';

const roleStyles: Record<string, { bg: string; text: string; border: string }> = {
  super_admin: {
    bg: 'rgba(168, 85, 247, 0.12)',
    text: '#c084fc',
    border: 'rgba(168, 85, 247, 0.35)',
  },
  admin: {
    bg: 'rgba(59, 130, 246, 0.12)',
    text: '#60a5fa',
    border: 'rgba(59, 130, 246, 0.35)',
  },
  operator: {
    bg: 'rgba(6, 182, 212, 0.12)',
    text: '#22d3ee',
    border: 'rgba(6, 182, 212, 0.35)',
  },
  user: {
    bg: 'rgba(100, 116, 139, 0.12)',
    text: '#94a3b8',
    border: 'rgba(100, 116, 139, 0.35)',
  },
};

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const response = await usersApi.list();
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleDelete = async (id: number) => {
    if (confirm('Are you sure you want to delete this user?')) {
      try {
        await usersApi.delete(id);
        setUsers(prev => prev.filter(u => u.id !== id));
      } catch (error) {
        console.error('Failed to delete user:', error);
      }
    }
  };

  const handleToggleStatus = async (user: any) => {
    try {
      const updatedStatus = !user.is_active;
      await usersApi.update(user.id, { ...user, is_active: updatedStatus });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_active: updatedStatus } : u));
    } catch (error) {
      console.error('Failed to toggle status:', error);
    }
  };

  if (loading) {
    return (
      <div className="loading-state" style={{ minHeight: '300px' }}>
        <div className="loading-spinner" />
        <div>Fetching users data...</div>
      </div>
    );
  }

  const totalUsers = users.length;
  const adminOperators = users.filter(u => u.role === 'admin' || u.role === 'operator' || u.role === 'super_admin').length;
  const totalQuotaUsed = users.reduce((acc, u) => acc + (u.quota_used || 0), 0);
  const activeUsers = users.filter(u => u.is_active).length;

  const totalQuotaAllocated = users.reduce((acc, u) => acc + (u.quota_pages || 1000), 0);
  const quotaPercentage = totalQuotaAllocated > 0 ? Math.round((totalQuotaUsed / totalQuotaAllocated) * 100) : 0;

  const getRoleLabel = (role: string) => {
    if (!role) return 'User';
    return role.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const getAvatarStyle = (role: string) => {
    const style = roleStyles[role] || roleStyles.user;
    return {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: style.bg,
      border: `1px solid ${style.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 'bold',
      color: style.text,
      fontFamily: "'Share Tech Mono', monospace",
      fontSize: '14px',
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'rgba(0, 212, 255, 0.1)', border: '1px solid rgba(0, 212, 255, 0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent-cyan)',
          }}>
            <User size={20} />
          </div>
          <div>
            <h1 style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: '22px',
              color: 'var(--text-primary)',
              letterSpacing: '1px',
              margin: 0,
            }}>
              USERS MANAGEMENT
            </h1>
            <p style={{
              fontFamily: "'Rajdhani', sans-serif",
              fontSize: '12px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              margin: 0,
            }}>
              Manage system users and view print quotas
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={fetchUsers}
            className="btn-primary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
            disabled={loading}
          >
            <RefreshCw
              size={16}
              style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined}
            />
            Refresh
          </button>
          <button
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(0, 255, 136, 0.1)',
              borderColor: 'rgba(0, 255, 136, 0.3)',
              color: 'var(--accent-green)'
            }}
            onClick={() => alert('Add User triggered')}
          >
            <UserPlus size={16} />
            Add User
          </button>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="stat-cards">
        {/* Card 1: Total Users */}
        <div className="stat-card" style={{ padding: '20px' }}>
          <div className="stat-card-header">
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px',
              background: 'rgba(0, 212, 255, 0.08)',
              border: '1px solid rgba(0, 212, 255, 0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent-cyan)',
            }}>
              <User size={18} />
            </div>
            <span className="stat-badge cyan">Total</span>
          </div>
          <div className="stat-value" style={{ textShadow: '0 0 20px rgba(0, 212, 255, 0.3)' }}>
            {totalUsers}
          </div>
          <div className="stat-label">Total Users</div>
        </div>

        {/* Card 2: Admins/Operators */}
        <div className="stat-card" style={{ padding: '20px' }}>
          <div className="stat-card-header">
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px',
              background: 'rgba(168, 85, 247, 0.08)',
              border: '1px solid rgba(168, 85, 247, 0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#c084fc',
            }}>
              <Shield size={18} />
            </div>
            <span className="stat-badge amber">Staff</span>
          </div>
          <div className="stat-value" style={{ color: '#c084fc', textShadow: '0 0 20px rgba(168, 85, 247, 0.3)' }}>
            {adminOperators}
          </div>
          <div className="stat-label">Admins & Operators</div>
        </div>

        {/* Card 3: Quota Used */}
        <div className="stat-card" style={{ padding: '20px' }}>
          <div className="stat-card-header">
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent-amber)',
            }}>
              <Clock size={18} />
            </div>
            <span className="stat-badge amber">Pages</span>
          </div>
          <div className="stat-value" style={{ color: 'var(--accent-amber)', textShadow: '0 0 20px rgba(245, 158, 11, 0.3)' }}>
            {totalQuotaUsed}
          </div>
          <div className="stat-label">Total Quota Used</div>
          <div className="stat-progress">
            <div className="stat-progress-bar" style={{ width: `${Math.min(100, quotaPercentage)}%`, background: 'linear-gradient(90deg, var(--accent-amber), var(--accent-red))' }} />
          </div>
          <div className="stat-subtext">
            <span>{quotaPercentage}%</span> of total allocation
          </div>
        </div>

        {/* Card 4: Active Users */}
        <div className="stat-card" style={{ padding: '20px' }}>
          <div className="stat-card-header">
            <div style={{
              width: '36px', height: '36px', borderRadius: '8px',
              background: 'rgba(0, 255, 136, 0.08)',
              border: '1px solid rgba(0, 255, 136, 0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent-green)',
            }}>
              <Check size={18} />
            </div>
            <span className="stat-badge green">Online</span>
          </div>
          <div className="stat-value" style={{ color: 'var(--accent-green)', textShadow: '0 0 20px rgba(0, 255, 136, 0.3)' }}>
            {activeUsers}
          </div>
          <div className="stat-label">Active Users</div>
        </div>
      </div>

      {/* ── Table Card ───────────────────────────────────────────────────── */}
      {users.length === 0 ? (
        <div className="card" style={{ padding: '48px', textAlign: 'center' }}>
          <User size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3 style={{
            fontFamily: "'Share Tech Mono', monospace",
            fontSize: '18px',
            color: 'var(--text-primary)',
            marginBottom: '8px',
          }}>
            NO USERS FOUND
          </h3>
          <p style={{
            fontFamily: "'Rajdhani', sans-serif",
            fontSize: '14px',
            color: 'var(--text-muted)',
            marginBottom: '20px',
          }}>
            Get started by adding your first user to the system.
          </p>
          <button
            className="btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(0, 255, 136, 0.1)',
              borderColor: 'rgba(0, 255, 136, 0.3)',
              color: 'var(--accent-green)'
            }}
            onClick={() => alert('Add User triggered')}
          >
            <UserPlus size={16} />
            Create First User
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          {/* Table title bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}>
            <span className="section-title" style={{ margin: 0 }}>
              <User size={16} />
              Registered Users
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{
                  background: 'rgba(0, 212, 255, 0.04)',
                  borderBottom: '1px solid var(--border)',
                }}>
                  {['User', 'Email', 'Role', 'Department', 'Quota', 'Last Login', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{
                      padding: '12px 16px',
                      textAlign: 'left',
                      fontFamily: "'Rajdhani', sans-serif",
                      fontSize: '11px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '1.5px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map((user, idx) => {
                  const roleStyle = roleStyles[user.role] || roleStyles.user;
                  const isEven = idx % 2 === 0;

                  return (
                    <tr
                      key={user.id}
                      style={{
                        background: isEven ? 'transparent' : 'rgba(0, 212, 255, 0.015)',
                        borderBottom: '1px solid var(--border)',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = isEven ? 'transparent' : 'rgba(0, 212, 255, 0.015)')}
                    >
                      {/* User Column (Avatar + name) */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={getAvatarStyle(user.role)}>
                            {user.username ? user.username[0].toUpperCase() : '?'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                              {user.full_name || user.username}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: "'Share Tech Mono', monospace" }}>
                              ID: {user.id}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {user.email || '—'}
                      </td>

                      {/* Role Badge */}
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '4px 10px',
                          borderRadius: '20px',
                          background: roleStyle.bg,
                          border: `1px solid ${roleStyle.border}`,
                          fontSize: '11px',
                          fontFamily: "'Rajdhani', sans-serif",
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.8px',
                          color: roleStyle.text,
                        }}>
                          {getRoleLabel(user.role)}
                        </span>
                      </td>

                      {/* Department */}
                      <td style={{ padding: '12px 16px', fontSize: '13px', color: 'var(--text-muted)' }}>
                        {user.department || 'N/A'}
                      </td>

                      {/* Quota */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: '13px', color: 'var(--text-primary)' }}>
                            {user.quota_used || 0} / {user.quota_pages || 1000}
                          </span>
                          <div style={{ width: '80px', height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(100, Math.round(((user.quota_used || 0) / (user.quota_pages || 1000)) * 100))}%`,
                              background: 'var(--accent-cyan)'
                            }} />
                          </div>
                        </div>
                      </td>

                      {/* Last Login */}
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
                          <Clock size={12} />
                          <span style={{ fontSize: '13px' }}>
                            {user.last_login ? format(new Date(user.last_login), 'MM/dd HH:mm') : 'Never'}
                          </span>
                        </div>
                      </td>

                      {/* Status Toggle */}
                      <td style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                        <div
                          onClick={() => handleToggleStatus(user)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <div style={{
                            width: '36px',
                            height: '20px',
                            borderRadius: '10px',
                            background: user.is_active ? 'rgba(0, 255, 136, 0.15)' : 'rgba(255, 61, 90, 0.15)',
                            border: user.is_active ? '1px solid rgba(0, 255, 136, 0.4)' : '1px solid rgba(255, 61, 90, 0.4)',
                            position: 'relative',
                            transition: 'all 0.2s ease',
                          }}>
                            <div style={{
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              background: user.is_active ? 'var(--accent-green)' : 'var(--accent-red)',
                              position: 'absolute',
                              top: '3px',
                              left: user.is_active ? '19px' : '3px',
                              transition: 'left 0.2s ease',
                              boxShadow: user.is_active ? '0 0 6px var(--accent-green)' : '0 0 6px var(--accent-red)',
                            }} />
                          </div>
                          <span style={{
                            fontSize: '12px',
                            fontFamily: "'Rajdhani', sans-serif",
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            color: user.is_active ? 'var(--accent-green)' : 'var(--accent-red)',
                          }}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            onClick={() => alert(`Edit User ${user.username} triggered`)}
                            style={{
                              background: 'rgba(0, 212, 255, 0.05)',
                              border: '1px solid rgba(0, 212, 255, 0.15)',
                              borderRadius: '6px',
                              padding: '6px',
                              color: 'var(--accent-cyan)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(0, 212, 255, 0.15)';
                              e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.4)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(0, 212, 255, 0.05)';
                              e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.15)';
                            }}
                          >
                            <Edit size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(user.id)}
                            style={{
                              background: 'rgba(255, 61, 90, 0.05)',
                              border: '1px solid rgba(255, 61, 90, 0.15)',
                              borderRadius: '6px',
                              padding: '6px',
                              color: 'var(--accent-red)',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 61, 90, 0.15)';
                              e.currentTarget.style.borderColor = 'rgba(255, 61, 90, 0.4)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = 'rgba(255, 61, 90, 0.05)';
                              e.currentTarget.style.borderColor = 'rgba(255, 61, 90, 0.15)';
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}