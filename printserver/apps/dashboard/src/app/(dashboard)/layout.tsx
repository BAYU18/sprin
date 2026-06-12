'use client';

import Sidebar from '@/components/Sidebar';
import MobileNav from '@/components/MobileNav';
import DashboardHeader from '@/components/DashboardHeader';
import { useState, useEffect } from 'react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Apply saved theme preference on mount
  useEffect(() => {
    const saved = localStorage.getItem('ps-theme');
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  const toggleDarkMode = () => {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'light') {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('ps-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('ps-theme', 'light');
    }
  };

  const handleSidebarClose = () => {
    setSidebarOpen(false);
  };

  return (
    <div className="app-container">
      <Sidebar isOpen={sidebarOpen} onClose={handleSidebarClose} />
      <main className="main-content">
        <DashboardHeader
          onMenuToggle={() => setSidebarOpen(!sidebarOpen)}
          onDarkModeToggle={toggleDarkMode}
        />
        <div className="page-content">
          {children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}