import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

const api = axios.create({
  baseURL: API_URL || undefined,
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // Read token from Zustand persist storage (key: 'auth-storage')
    try {
      const stored = localStorage.getItem('auth-storage');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Zustand persist stores state under a 'state' wrapper
        const token = parsed.state?.token || parsed.token;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch {
      // Fallback: try standalone token key
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      if (typeof window !== 'undefined') {
        // Clear Zustand persist storage (auth-storage contains { user, token, isAuthenticated })
        localStorage.removeItem('auth-storage');
        // Also clear any standalone token (for safety)
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export const auth = {
  login: (username: string, password: string) =>
    api.post('/api/auth/login', { username, password }),
  register: (data: any) => api.post('/api/auth/register', data),
  refresh: (refreshToken: string) =>
    api.post('/api/auth/refresh', { refreshToken }),
};

export const printers = {
  list: (params?: any) => api.get('/api/printers', { params }),
  removed: () => api.get('/api/printers/removed'),
  get: (id: number) => api.get(`/api/printers/${id}`),
  create: (data: any) => api.post('/api/printers', data),
  update: (id: number, data: any) => api.put(`/api/printers/${id}`, data),
  delete: (id: number) => api.delete(`/api/printers/${id}`),
  restore: (id: number) => api.post(`/api/printers/${id}/restore`),
  status: (id: number) => api.get(`/api/printers/${id}/status`),
  jobs: (id: number, params?: any) => api.get(`/api/printers/${id}/jobs`, { params }),
  testPrint: (id: number) => api.post(`/api/printers/${id}/test-print`),
  clearQueue: (id: number) => api.post(`/api/printers/${id}/clear-queue`),
};

export const jobs = {
  list: (params?: any) => api.get('/api/jobs', { params }),
  get: (jobId: string) => api.get(`/api/jobs/${jobId}`),
  submit: (data: any) => api.post('/api/jobs/submit', data),
  cancel: (jobId: string) => api.post(`/api/jobs/${jobId}/cancel`),
  retry: (jobId: string) => api.post(`/api/jobs/${jobId}/retry`),
  hold: (jobId: string) => api.post(`/api/jobs/${jobId}/hold`),
  release: (jobId: string) => api.post(`/api/jobs/${jobId}/release`),
  stats: {
    today: () => api.get('/api/jobs/stats/today'),
    week: () => api.get('/api/jobs/stats/week'),
  },
  deadLetter: {
    list: (params?: any) => api.get('/api/jobs/dead-letter', { params }),
    requeue: (jobIds?: string[]) => api.post('/api/jobs/dead-letter/requeue', { jobIds }),
    discard: (jobIds?: string[]) => api.post('/api/jobs/dead-letter/discard', { jobIds }),
  },
};

export const clients = {
  list: () => api.get('/api/clients'),
  get: (id: number) => api.get(`/api/clients/${id}`),
  register: (data: any) => api.post('/api/clients/register', data),
  heartbeat: (id: number, data: any) => api.post(`/api/clients/${id}/heartbeat`, data),
  delete: (id: number) => api.delete(`/api/clients/${id}`),
  onlineCount: () => api.get('/api/clients/online/count'),
};

export const users = {
  list: () => api.get('/api/users'),
  get: (id: number) => api.get(`/api/users/${id}`),
  create: (data: any) => api.post('/api/users', data),
  update: (id: number, data: any) => api.put(`/api/users/${id}`, data),
  delete: (id: number) => api.delete(`/api/users/${id}`),
  quota: (id: number) => api.get(`/api/users/${id}/quota`),
};

export const alerts = {
  list: (params?: any) => api.get('/api/alerts', { params }),
  unresolved: () => api.get('/api/alerts/unresolved'),
  resolve: (id: number) => api.put(`/api/alerts/${id}/resolve`),
  resolveAll: () => api.put('/api/alerts/resolve-all'),
  delete: (id: number) => api.delete(`/api/alerts/${id}`),
};

export const analytics = {
  overview: () => api.get('/api/analytics/overview'),
  volume: (days?: number) => api.get('/api/analytics/volume', { params: { days } }),
  printersUsage: () => api.get('/api/analytics/printers/usage'),
  topUsers: (limit?: number) => api.get('/api/analytics/users/top', { params: { limit } }),
  failures: () => api.get('/api/analytics/failures'),
  departments: () => api.get('/api/analytics/departments'),
  paperUsage: () => api.get('/api/analytics/paper/usage'),
};

export const settings = {
  get: () => api.get('/api/settings'),
  update: (data: any) => api.put('/api/settings', data),
  channels: () => api.get('/api/settings/notifications/channels'),
  serverInfo: () => api.get('/api/settings/server-info'),
  backupList: () => api.get('/api/settings/backup/list'),
  backupTrigger: () => api.post('/api/settings/backup/trigger'),
  backupRestore: (filename: string) => api.post('/api/settings/backup/restore', { filename }),
  // Download returns the file as a blob; responseType:'blob' makes axios
  // hand back a Buffer/Binary instead of trying to JSON.parse it.
  backupDownload: (filename: string) => api.get(`/api/settings/backup/download/${encodeURIComponent(filename)}`, { responseType: 'blob' }),
  // Upload uses XHR for progress; this helper is the JSON endpoint wrapper (no progress)
  backupUpload: (formData: FormData) => api.post('/api/settings/backup/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
};

export const paper = {
  list: () => api.get('/api/paper'),
  getDefault: () => api.get('/api/paper/default'),
  setDefault: (name: string) => api.put('/api/paper/default', { default: name }),
  getCustom: () => api.get('/api/paper/custom'),
  addCustom: (entry: { name: string; widthMm: number; heightMm: number }) =>
    api.post('/api/paper/custom', entry),
  removeCustom: (name: string) => api.delete(`/api/paper/custom/${encodeURIComponent(name)}`),
  getForPrinter: (id: number) => api.get(`/api/printers/${id}/paper`),
  setForPrinter: (id: number, paper: any) => api.put(`/api/printers/${id}/paper`, paper),
  clearForPrinter: (id: number) => api.delete(`/api/printers/${id}/paper`),
};

export const badges = {
  // Aggregated sidebar counts: alerts_unresolved, jobs_pending,
  // printers_offline, clients_online, clients_total
  get: () => api.get('/api/badges'),
};

export const nodes = {
  list: (params?: any) => api.get('/api/nodes', { params }),
  get: (id: number) => api.get(`/api/nodes/${id}`),
  register: (data: any) => api.post('/api/nodes/register', data),
  heartbeat: (id: number, data: any) => api.post(`/api/nodes/${id}/heartbeat`, data),
  delete: (id: number) => api.delete(`/api/nodes/${id}`),
};

export const drivers = {
  list: () => api.get('/api/drivers'),
  get: (id: number) => api.get(`/api/drivers/${id}`),
  create: (data: any) => api.post('/api/drivers', data),
  update: (id: number, data: any) => api.put(`/api/drivers/${id}`, data),
  delete: (id: number) => api.delete(`/api/drivers/${id}`),
  upload: (data: any) => api.post('/api/drivers/upload', data),
  assignToPrinter: (printerId: number, driverId: number | null) =>
    api.put(`/api/printers/${printerId}/driver`, { driver_id: driverId }),
  // Smart auto-detect: match printers to catalog drivers by name.
  // opts.dry_run=true previews; opts.reassign=true re-evaluates assigned printers too.
  autoAssign: (opts: { dry_run?: boolean; reassign?: boolean; min_score?: number } = {}) =>
    api.post('/api/drivers/auto-assign', opts),
  // Rank best driver candidates for a single printer (no write).
  suggest: (printerId: number) =>
    api.get(`/api/printers/${printerId}/driver/suggest`),
};

export default api;