'use client';

import { useEffect, useState } from 'react';
import { users as usersApi } from '@/lib/api';
import { Plus, RefreshCw, Edit, Trash2, User, Shield } from 'lucide-react';
import { format } from 'date-fns';

const roleColors: Record<string, string> = {
  super_admin: 'bg-red-500/20 text-red-400',
  admin: 'bg-purple-500/20 text-purple-400',
  operator: 'bg-blue-500/20 text-blue-400',
  user: 'bg-slate-500/20 text-slate-400'
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
        <h1 className="text-2xl font-bold">Users</h1>
        <div className="flex items-center gap-2">
          <button onClick={fetchUsers} className="btn-primary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="card text-center py-12">
          <User className="w-12 h-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Users</h3>
          <p className="text-slate-400">Add your first user to get started</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-700">
                <th className="pb-3 font-medium">User</th>
                <th className="pb-3 font-medium">Email</th>
                <th className="pb-3 font-medium">Role</th>
                <th className="pb-3 font-medium">Department</th>
                <th className="pb-3 font-medium">Quota</th>
                <th className="pb-3 font-medium">Last Login</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-600 rounded-full flex items-center justify-center text-sm font-bold">
                        {user.username[0].toUpperCase()}
                      </div>
                      <span className="font-medium">{user.full_name || user.username}</span>
                    </div>
                  </td>
                  <td className="py-3 text-slate-400">{user.email}</td>
                  <td className="py-3">
                    <span className={`badge ${roleColors[user.role] || roleColors.user}`}>
                      {user.role?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 text-slate-400">{user.department || 'N/A'}</td>
                  <td className="py-3">
                    <span className="text-slate-400">{user.quota_used || 0}</span>
                    <span className="text-slate-500"> / {user.quota_pages || 1000}</span>
                  </td>
                  <td className="py-3 text-slate-400 text-sm">
                    {user.last_login ? format(new Date(user.last_login), 'MM/dd HH:mm') : 'Never'}
                  </td>
                  <td className="py-3">
                    <span className={`badge ${user.is_active ? 'badge-success' : 'badge-error'}`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="py-3">
                    <div className="flex items-center gap-1">
                      <button className="p-2 hover:bg-slate-700 rounded">
                        <Edit className="w-4 h-4 text-slate-400" />
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="p-2 hover:bg-red-500/20 text-red-400 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}