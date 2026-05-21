'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, useAppStore } from '@/lib/store';
import { useSocket, on, off } from '@/hooks/useSocket';
import { auth, printers, jobs as jobsApi, clients, analytics } from '@/lib/api';
import {
  LayoutDashboard, Printer, FileText, Users, AlertTriangle,
  BarChart3, Settings, LogOut, Menu, X, Bell, RefreshCw,
  Monitor, Clock, CheckCircle, XCircle, Activity
} from 'lucide-react';
import Link from 'next/link';
import { format } from 'date-fns';

const navItems = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/printers', icon: Printer, label: 'Printers' },
  { href: '/jobs', icon: FileText, label: 'Print Jobs' },
  { href: '/clients', icon: Monitor, label: 'Clients' },
  { href: '/users', icon: Users, label: 'Users' },
  { href: '/alerts', icon: AlertTriangle, label: 'Alerts' },
  { href: '/analytics', icon: BarChart3, label: 'Analytics' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const { sidebarOpen, toggleSidebar } = useAppStore();
  const { socket, connected } = useSocket();

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    router.push('/login');
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-900 flex">
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-slate-800 border-r border-slate-700 flex flex-col transition-all duration-300`}>
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          {sidebarOpen && (
            <div>
              <h1 className="font-bold text-lg text-white">PrintServer</h1>
              <p className="text-xs text-slate-400">Pro Edition</p>
            </div>
          )}
          <button onClick={toggleSidebar} className="p-2 hover:bg-slate-700 rounded-lg">
            {sidebarOpen ? <X className="w-5 h-5 text-slate-400" /> : <Menu className="w-5 h-5 text-slate-400" />}
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition text-slate-400 hover:text-white"
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className={`flex items-center ${sidebarOpen ? 'gap-3' : 'justify-center'}`}>
            <div className="w-10 h-10 bg-slate-600 rounded-full flex items-center justify-center text-sm font-bold">
              {user?.username?.[0]?.toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{user?.username}</p>
                <p className="text-xs text-slate-400">{user?.role}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className={`mt-3 flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition text-slate-400 hover:text-white w-full ${sidebarOpen ? '' : 'justify-center'}`}
          >
            <LogOut className="w-5 h-5" />
            {sidebarOpen && <span>Logout</span>}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-slate-400">
              {connected ? 'Connected to server' : 'Disconnected'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-slate-700 rounded-lg relative">
              <Bell className="w-5 h-5 text-slate-400" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </button>
          </div>
        </header>

        <div className="flex-1 p-6 overflow-auto">
          {children}
        </div>
      </main>
    </div>
  );
}