'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import { badges as badgesApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

type BadgeCounts = {
  alerts_unresolved: number;
  jobs_pending: number;
  printers_offline: number;
  clients_online: number;
  clients_total: number;
};

const EMPTY_BADGES: BadgeCounts = {
  alerts_unresolved: 0,
  jobs_pending: 0,
  printers_offline: 0,
  clients_online: 0,
  clients_total: 0,
};

export default function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const [uptime, setUptime] = useState('00:00:00');
  const [isMobileOpen, setIsMobileOpen] = useState(isOpen);
  const [counts, setCounts] = useState<BadgeCounts>(EMPTY_BADGES);
  const startTimeRef = useRef(Date.now());
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  // Highlight active route — exact match for root, prefix match for nested paths
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(href + '/');
  };

  useEffect(() => {
    setIsMobileOpen(isOpen);
  }, [isOpen]);

  useEffect(() => {
    const updateUptime = () => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const s = String(elapsed % 60).padStart(2, '0');
      setUptime(`${h}:${m}:${s}`);
    };
    updateUptime();
    const interval = setInterval(updateUptime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll sidebar badge counts every 60s. Failures are silent — the sidebar
  // is non-essential, never block render on it.
  useEffect(() => {
    let cancelled = false;
    const fetchBadges = async () => {
      try {
        const res = await badgesApi.get();
        if (!cancelled && res.data) setCounts(res.data);
      } catch {
        /* keep last good value */
      }
    };
    fetchBadges();
    const interval = setInterval(fetchBadges, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Escape key closes mobile sidebar
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobileOpen) {
        setIsMobileOpen(false);
        if (onClose) onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isMobileOpen, onClose]);

  // Menu items: route, icon key, label, and an optional badge resolver.
  //   - `tone`: 'danger' (red), 'warn' (amber), 'ok' (cyan), 'mute' (gray)
  //   - resolver returns null when the badge should be hidden.
  const navItems: {
    href: string;
    icon: string;
    label: string;
    badge?: { value: number; tone: 'danger' | 'warn' | 'ok' | 'mute' };
  }[] = [
    { href: '/', icon: 'dashboard', label: 'Dashboard' },
    {
      href: '/printers',
      icon: 'printer',
      label: 'Printers',
      badge: counts.printers_offline > 0
        ? { value: counts.printers_offline, tone: 'warn' }
        : undefined,
    },
    {
      href: '/clients',
      icon: 'nodes',
      label: 'Nodes',
      badge: counts.clients_online > 0
        ? { value: counts.clients_online, tone: 'ok' }
        : undefined,
    },
    { href: '/health', icon: 'activity', label: 'Health' },
    {
      href: '/jobs',
      icon: 'file',
      label: 'Job Queue',
      badge: counts.jobs_pending > 0
        ? { value: counts.jobs_pending, tone: 'warn' }
        : undefined,
    },
    { href: '/queues', icon: 'layers', label: 'Active Queues' },
    { href: '/jobs/dead-letter', icon: 'alert-triangle', label: 'Dead Letter' },
    { href: '/analytics', icon: 'chart', label: 'Analytics' },
    { href: '/drivers', icon: 'driver', label: 'Drivers' },
    {
      href: '/alerts',
      icon: 'bell',
      label: 'Alerts',
      badge: counts.alerts_unresolved > 0
        ? { value: counts.alerts_unresolved, tone: counts.alerts_unresolved > 99 ? 'danger' : 'warn' }
        : undefined,
    },
    { href: '/connect', icon: 'link', label: 'Connect Agent' },
    { href: '/users', icon: 'user', label: 'Users' },
    { href: '/settings', icon: 'settings', label: 'Settings' },
  ];

  const getIcon = (icon: string) => {
    switch (icon) {
      case 'dashboard':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
          </svg>
        );
      case 'printer':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
        );
      case 'monitor':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        );
      case 'file':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        );
      case 'chart':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        );
      case 'settings':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        );
      case 'driver':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <line x1="6" y1="10" x2="6" y2="14"/>
            <line x1="10" y1="10" x2="14" y2="10"/>
            <line x1="10" y1="14" x2="14" y2="14"/>
            <line x1="18" y1="10" x2="18" y2="14"/>
          </svg>
        );
      case 'bell':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
        );
      case 'nodes':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        );
      case 'activity':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
        );
      case 'layers':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 2 7 12 12 22 7 12 2"/>
            <polyline points="2 17 12 22 22 17"/>
            <polyline points="2 12 12 17 22 12"/>
          </svg>
        );
      case 'link':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        );
      case 'user':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        );
      case 'alert-triangle':
        return (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        );
      default:
        return null;
    }
  };

  // Tone → CSS class map. Cyberpunk notched shape comes from .nav-badge class
  // in globals.css — we only override the per-tone color accents here.
  const badgeStyle = (tone: 'danger' | 'warn' | 'ok' | 'mute'): React.CSSProperties => {
    switch (tone) {
      case 'danger':
        return {
          color: '#fca5a5',
          // Per-tone overrides for the notched shape (background, border, glow)
          ['--badge-bg' as any]: 'rgba(239,68,68,0.18)',
          ['--badge-border' as any]: 'rgba(239,68,68,0.55)',
          ['--badge-glow' as any]: 'rgba(239,68,68,0.25)',
        };
      case 'warn':
        return {
          color: '#fbbf24',
          ['--badge-bg' as any]: 'rgba(255,184,0,0.18)',
          ['--badge-border' as any]: 'rgba(255,184,0,0.55)',
          ['--badge-glow' as any]: 'rgba(255,184,0,0.25)',
        };
      case 'ok':
        return {
          color: '#67e8f9',
          ['--badge-bg' as any]: 'rgba(0,212,255,0.18)',
          ['--badge-border' as any]: 'rgba(0,212,255,0.55)',
          ['--badge-glow' as any]: 'rgba(0,212,255,0.25)',
        };
      case 'mute':
        return {
          color: '#cbd5e1',
          ['--badge-bg' as any]: 'rgba(148,163,184,0.18)',
          ['--badge-border' as any]: 'rgba(148,163,184,0.55)',
          ['--badge-glow' as any]: 'rgba(148,163,184,0.25)',
        };
    }
  };

  // Compact large numbers: 1234 → 1.2K, 1500 → 1.5K
  const fmtBadge = (n: number) => {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
    return `${(n / 1_000_000).toFixed(1)}M`;
  };

  const handleNavClick = () => {
    if (onClose) {
      onClose();
    }
    setIsMobileOpen(false);
  };

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="mobile-overlay"
          onClick={() => {
            setIsMobileOpen(false);
            if (onClose) onClose();
          }}
          role="presentation"
        />
      )}

      <aside className={`sidebar ${isMobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <div className="logo-icon">
              <svg viewBox="0 0 32 32" fill="none">
                <rect x="2" y="2" width="28" height="28" rx="4" stroke="#00d4ff" strokeWidth="1.5"/>
                <circle cx="16" cy="16" r="4" fill="#00d4ff" className="pulse-dot"/>
                <line x1="16" y1="2" x2="16" y2="8" stroke="#00d4ff" strokeWidth="1.5"/>
                <line x1="16" y1="24" x2="16" y2="30" stroke="#00d4ff" strokeWidth="1.5"/>
                <line x1="2" y1="16" x2="8" y2="16" stroke="#00d4ff" strokeWidth="1.5"/>
                <line x1="24" y1="16" x2="30" y2="16" stroke="#00d4ff" strokeWidth="1.5"/>
              </svg>
            </div>
            <span>PrintServer</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${isActive(item.href) ? 'active' : ''}`}
              onClick={handleNavClick}
              style={{ '--index': index } as React.CSSProperties}
            >
              {getIcon(item.icon)}
              <span className="nav-label">{item.label}</span>
              {item.badge && (
                <span
                  className="nav-badge"
                  style={badgeStyle(item.badge.tone)}
                  title={`${item.label}: ${item.badge.value}`}
                >
                  {fmtBadge(item.badge.value)}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          {user && (
            <div className="user-chip">
              <div className="user-avatar">
                {(user.full_name || user.username || '?').charAt(0).toUpperCase()}
              </div>
              <div className="user-meta">
                <span className="user-name">{user.full_name || user.username}</span>
                <span className="user-role">{user.role}</span>
              </div>
            </div>
          )}

          <button type="button" className="logout-btn" onClick={handleLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>LOGOUT</span>
          </button>

          <div className="server-uptime">
            UPTIME: <span>{uptime}</span>
          </div>
          <div className="version-tag">v2.4.1 // Enterprise</div>
        </div>
      </aside>
    </>
  );
}
