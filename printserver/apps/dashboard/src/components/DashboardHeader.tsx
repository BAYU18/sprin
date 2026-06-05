'use client';

import { useEffect, useState } from 'react';

interface DashboardHeaderProps {
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
  onMenuToggle?: () => void;
  onDarkModeToggle?: () => void;
}

export default function DashboardHeader({ onRefresh, loading = false, error = null, onMenuToggle, onDarkModeToggle }: DashboardHeaderProps) {
  const [clock, setClock] = useState('00:00:00');
  const [date, setDate] = useState('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock(now.toTimeString().slice(0, 8));
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="header">
      <div className="header-left">
        {onMenuToggle && (
          <button 
            className="mobile-menu-toggle"
            onClick={onMenuToggle}
            aria-label="Toggle menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        )}
        <span className="header-title">PrintServer Pro</span>
      </div>

      <div className="header-center">
        <div className="edition-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
          Enterprise Edition
        </div>
      </div>

      <div className="header-right">
        <button
          className="theme-toggle"
          onClick={onDarkModeToggle}
          title="Toggle dark/light mode"
          aria-label="Toggle dark mode"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        </button>
        <div className="header-datetime">
          <div className="live-clock">{clock}</div>
          <div className="live-date">{date}</div>
        </div>
        <button
          className={`refresh-btn ${loading ? 'spinning' : ''}`}
          onClick={onRefresh}
          title="Refresh Data"
          disabled={loading}
          aria-label="Refresh dashboard data"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <div className={`connection-status ${error ? 'error' : ''}`}>
          <div className="status-dot"></div>
          <span>{loading ? 'Loading...' : error ? 'Error' : 'Network Active'}</span>
        </div>
      </div>
    </header>
  );
}
