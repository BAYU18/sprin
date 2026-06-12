'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, Printer, FileText, Activity, AlertCircle, Monitor
} from 'lucide-react';

const C = {
  cyan: 'var(--accent-cyan)',
  muted: 'var(--text-muted)',
  border: 'var(--border)',
  card: 'var(--bg-card)',
  sec: 'var(--bg-secondary)',
};

const items = [
  { href: '/',           label: 'Home',     icon: Home },
  { href: '/printers',   label: 'Printers', icon: Printer },
  { href: '/clients',    label: 'Nodes',    icon: Monitor },
  { href: '/jobs',       label: 'Jobs',     icon: FileText },
  { href: '/health',     label: 'Health',   icon: Activity },
  { href: '/alerts',     label: 'Alerts',   icon: AlertCircle },
];

export default function MobileNav() {
  const pathname = usePathname() || '/';
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <nav
      className="mobile-nav"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border)',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 90,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {items.map((it) => {
        const Icon = it.icon;
        const active = isActive(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              flex: 1,
              height: '100%',
              textDecoration: 'none',
              color: active ? C.cyan : C.muted,
              transition: 'color 0.15s',
              background: active ? 'rgba(0,212,255,0.06)' : 'transparent',
            }}
          >
            <Icon size={18} />
            <span style={{ fontSize: 10, fontFamily: "'Rajdhani', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {it.label}
            </span>
          </Link>
        );
      })}
      <style jsx global>{`
        @media (max-width: 768px) {
          .mobile-nav { display: flex !important; }
          .page-content { padding-bottom: 80px !important; }
        }
      `}</style>
    </nav>
  );
}
