import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';

export function useAuth(requireAuth = true) {
  const router = useRouter();
  const { user, isAuthenticated, hasHydrated } = useAuthStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Wait for Zustand persist to rehydrate from localStorage before making auth decisions
    if (!hasHydrated) {
      setLoading(true);
      return;
    }
    if (requireAuth && !isAuthenticated) {
      router.push('/login');
    } else if (!requireAuth && isAuthenticated) {
      router.push('/');
    }
    setLoading(false);
  }, [requireAuth, isAuthenticated, hasHydrated, router]);

  return { user, isAuthenticated, loading, hasHydrated };
}