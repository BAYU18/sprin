'use client';

import { useEffect, useState } from 'react';

interface DashboardHeaderProps {
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
}

export default function DashboardHeader({ onRefresh, loading = false, error = null }: DashboardHeaderProps) {
  const [clock, setClock] = useState('00:00:00');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock(now.toTimeString().slice(0, 8));
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="header">
      <div className="header-left">
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
        <div className="live-clock" id="live-clock">{clock}</div>
        <button
          className={`refresh-btn ${loading ? 'spinning' : ''}`}
          onClick={onRefresh}
          title="Refresh Data"
          disabled={loading}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <div className={`connection-status ${error ? 'error' : ''}`}>
          <div className="status-dot"></div>
          {loading ? 'Loading...' : error ? 'Connection Error' : 'Network Active'}
        </div>
      </div>
    </header>
  );
}