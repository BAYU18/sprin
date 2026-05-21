import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';

export function useAuth(requireAuth = true) {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (requireAuth && !isAuthenticated) {
      router.push('/login');
    } else if (!requireAuth && isAuthenticated) {
      router.push('/');
    }
    setLoading(false);
  }, [requireAuth, isAuthenticated, router]);

  return { user, isAuthenticated, loading };
}