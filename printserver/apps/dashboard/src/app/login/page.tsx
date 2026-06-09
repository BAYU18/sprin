'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { auth } from '@/lib/api';
import { Monitor, Eye, EyeOff, AlertCircle, Zap } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await auth.login(username, password);
      if (response.data.token) {
        login(response.data.user, response.data.token);
        router.push('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cyber-root">
      {/* lightweight static background + 1 cheap pulse */}
      <div className="cyber-bg" aria-hidden>
        <div className="cyber-grid" />
        <div className="cyber-bolt cyber-bolt-1" />
        <div className="cyber-bolt cyber-bolt-2" />
      </div>

      <div className="cyber-card">
        <div className="text-center mb-8">
          <div className="cyber-logo">
            <Monitor className="w-8 h-8" />
            <Zap className="cyber-logo-spark" />
          </div>
          <h1 className="cyber-title">PrintServer Pro</h1>
          <p className="cyber-subtitle">Enterprise Print Management</p>
        </div>

        <h2 className="cyber-heading">// SIGN IN</h2>

        {error && (
          <div className="cyber-error">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="cyber-label">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="cyber-input"
              placeholder="admin"
              required
            />
          </div>

          <div>
            <label className="cyber-label">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="cyber-input pr-10"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="cyber-eye"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="cyber-btn">
            {loading ? 'AUTHENTICATING...' : 'SIGN IN'}
          </button>
        </form>

        <p className="cyber-hint">
          Default: <span>admin</span> / <span>changeme123</span>
        </p>
      </div>

      <style jsx global>{`
        @keyframes boltPulse {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.7; }
        }
        @keyframes titlePulse {
          0%, 100% { text-shadow: 0 0 6px rgba(0,240,255,0.6); }
          50% { text-shadow: 0 0 14px rgba(0,240,255,0.9); }
        }

        .cyber-root {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 1rem;
          background:
            radial-gradient(circle at 18% 12%, rgba(0,240,255,0.18), transparent 40%),
            radial-gradient(circle at 82% 88%, rgba(255,0,212,0.16), transparent 42%),
            #05010f;
          overflow: hidden;
          font-family: ui-monospace, 'Courier New', monospace;
        }

        .cyber-bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; }

        /* static grid, no animation, no perspective transform */
        .cyber-grid {
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(0,240,255,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(180,0,255,0.05) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: radial-gradient(ellipse at center, black 35%, transparent 80%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 35%, transparent 80%);
        }

        /* simple neon bolts: thin gradient lines, opacity-only pulse */
        .cyber-bolt {
          position: absolute;
          top: 0; bottom: 0;
          width: 2px;
          background: linear-gradient(to bottom, transparent, #00f0ff, #b400ff, transparent);
          will-change: opacity;
        }
        .cyber-bolt-1 { left: 16%; animation: boltPulse 3s ease-in-out infinite; }
        .cyber-bolt-2 { right: 18%; background: linear-gradient(to bottom, transparent, #ff00d4, #00f0ff, transparent); animation: boltPulse 4s ease-in-out infinite 1s; }

        .cyber-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 28rem;
          padding: 2.25rem;
          border-radius: 16px;
          background: rgba(10, 5, 26, 0.95);
          border: 1px solid rgba(0,240,255,0.35);
          box-shadow: 0 0 24px rgba(0,240,255,0.25), 0 0 1px rgba(255,0,212,0.5);
        }

        .cyber-logo {
          position: relative;
          display: inline-flex;
          align-items: center; justify-content: center;
          width: 70px; height: 70px;
          margin-bottom: 1rem;
          border-radius: 16px;
          color: #00f0ff;
          background: rgba(0,240,255,0.08);
          border: 1px solid rgba(0,240,255,0.4);
          box-shadow: 0 0 16px rgba(0,240,255,0.4);
        }
        .cyber-logo-spark {
          position: absolute;
          top: -8px; right: -8px;
          width: 22px; height: 22px;
          color: #ffec00;
        }

        .cyber-title {
          font-size: 1.9rem;
          font-weight: 800;
          letter-spacing: 2px;
          color: #fff;
          animation: titlePulse 4s ease-in-out infinite;
        }
        .cyber-subtitle {
          margin-top: 0.4rem;
          color: #7de3ff;
          font-size: 0.8rem;
          letter-spacing: 3px;
          text-transform: uppercase;
          opacity: 0.8;
        }

        .cyber-heading {
          text-align: center;
          margin-bottom: 1.5rem;
          color: #ff00d4;
          letter-spacing: 4px;
          font-size: 0.95rem;
          text-shadow: 0 0 8px rgba(255,0,212,0.6);
        }

        .cyber-error {
          margin-bottom: 1rem;
          padding: 0.75rem;
          display: flex; align-items: center; gap: 0.5rem;
          color: #ff5c8a;
          background: rgba(255,0,80,0.1);
          border: 1px solid rgba(255,0,80,0.5);
          border-radius: 10px;
        }

        .cyber-label {
          display: block;
          margin-bottom: 0.4rem;
          font-size: 0.72rem;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #6fb8d8;
        }

        .cyber-input {
          width: 100%;
          padding: 0.75rem 0.9rem;
          color: #eaffff;
          background: rgba(0, 240, 255, 0.04);
          border: 1px solid rgba(0,240,255,0.25);
          border-radius: 10px;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          font-family: inherit;
        }
        .cyber-input::placeholder { color: rgba(125,227,255,0.35); }
        .cyber-input:focus {
          border-color: #00f0ff;
          box-shadow: 0 0 0 2px rgba(0,240,255,0.2);
        }

        .cyber-eye {
          position: absolute;
          right: 0.75rem; top: 50%;
          transform: translateY(-50%);
          color: #6fb8d8;
          transition: color 0.2s;
        }
        .cyber-eye:hover { color: #00f0ff; }

        .cyber-btn {
          width: 100%;
          margin-top: 0.5rem;
          padding: 0.85rem;
          font-weight: 700;
          letter-spacing: 3px;
          color: #04121a;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          background: linear-gradient(90deg, #00f0ff, #b400ff);
          box-shadow: 0 0 14px rgba(0,240,255,0.35);
          transition: transform 0.15s, box-shadow 0.2s;
          font-family: inherit;
        }
        .cyber-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 0 22px rgba(0,240,255,0.6);
        }
        .cyber-btn:active:not(:disabled) { transform: translateY(0); }
        .cyber-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .cyber-hint {
          margin-top: 1.25rem;
          text-align: center;
          font-size: 0.72rem;
          color: #4a6a7a;
          letter-spacing: 1px;
        }
        .cyber-hint span { color: #00f0ff; }

        @media (prefers-reduced-motion: reduce) {
          .cyber-bolt, .cyber-title { animation: none; }
        }
      `}</style>
    </div>
  );
}
