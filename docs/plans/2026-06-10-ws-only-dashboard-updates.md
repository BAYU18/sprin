# PrintServer Pro — WebSocket-Only Dashboard Updates

**Goal:** Hapus `Failed to fetch printers: timeout of 15000ms exceeded` error spam dan 600+ req/menit ke API. Switch dari full-list re-fetch ke delta event + in-place state patch.

**Architecture:** Backend emit granular events (`printer:status`, `printer:patch`, `printer:created`, `printer:removed`). Frontend listen event → patch state in-place (mirror pola `clients/page.tsx`). Fallback: kalau WS putus >5s, switch ke polling 30s.

**Tech Stack:** Fastify (server), Socket.IO (events), Next.js 14 App Router, React 18, axios.

---

## Problem Statement

- Console error: `Failed to fetch printers: AxiosError: timeout of 15000ms exceeded`
- 600+ req/menit ke `/api/printers`, `/api/printers/removed`, `/api/printer-groups/tags/all`, `/api/printer-groups`, `/api/paper` (5 endpoint utama, ~120 req/menit per endpoint)
- Response time spike sampai 1.6-2.5 detik pada beberapa request (DB query 0.04ms, bukan dari query — dari event loop blocking atau axios queue)

### Root Cause

4 sumber spam:
1. `Sidebar.tsx:80` — `setInterval(fetchBadges, 30_000)` (1 req/30s, low)
2. `page.tsx:371` — `setInterval(fetchData, 30000)` di main dashboard
3. `connect/page.tsx:161` — `setInterval(fetchNodes, 15000)` di halaman connect
4. `clients/[id]/page.tsx:39` — `setInterval(fetchDetail, 15000)` di client detail

Plus `printers/page.tsx:185-205` useEffect yang panggil `fetchPrinters` di-mount dan re-fetch pada SEMUA socket event (`printer:update`, `printer:created`, `printer:removed`, `printer-group:created/updated/deleted`). Heartbeat IT-99 → emit → re-fetch → cache miss → query → response lambat karena axios client 8s timeout default + Next.js dev proxy.

**Solusi:** delta event + in-place patch (template: `clients/page.tsx:31-45`).

---

## Tasks

### Task 1: Backend — tambah granular printer events

**File:** `printserver/apps/server/src/routes/printers.ts`

Tambah emit granular di setiap mutation point. Penting: payload include `id` + kolom yang berubah saja, bukan full row.

Di `PUT /api/printers/:id` (update endpoint, ~line 200), `POST /api/printers/:id/restore`, `DELETE /api/printers/:id`, `POST /api/clients/:id/heartbeat` (yang mutate printer rows, `clients.ts:392`):

```typescript
// setelah update berhasil
fastify.io?.emit('printer:patch', { id, status: newStatus, updated_at: new Date() });
// atau 'printer:created' / 'printer:removed' sesuai operasi
```

**Step 1: Cari semua mutation point di `printers.ts` & `clients.ts` yang modify printers table.**

Lokasi:
- `printers.ts:30` GET (no emit, just cache)
- `printers.ts:99` GET /:id (no emit)
- `printers.ts:149` POST /:id/restore (emit `printer:patch` setelah restore)
- `printers.ts` (cari UPDATE/DELETE/CREATE)
- `clients.ts:208` POST /:id/heartbeat (line 386-392 mark offline → emit `printer:patch` untuk tiap printer affected)
- `clients.ts:255` printer sync insert/update

**Step 2: Implementasi emit `printer:patch` di clients.ts:386-399**

Lokasi tepat: `clients.ts:386-399` — block "Mark printers no longer reported as offline". Tambah:

```typescript
// Emit patch for each printer whose status changed (id only — frontend re-fetches column)
const offlineIds = await fastify.knex('printers')
  .where({ client_id: id })
  .whereNotIn('name', printerNames.map((n: string) => n.trim()))
  .select('id');
for (const row of offlineIds) {
  fastify.io?.emit('printer:patch', { id: row.id, status: 'offline' });
}
```

**Step 3: Tambah emit di printer insert/update path (`clients.ts:340-383`)**

```typescript
// Setelah .insert() berhasil (line 370-382) untuk new printer
fastify.io?.emit('printer:created', { id: newId, client_id: id, name: trimmedName, status: ... });
// Setelah .update() (line 354-356) untuk existing restored
fastify.io?.emit('printer:patch', { id: existing.id, status: 'online' });
```

**Step 4: Cache invalidation tetap ada** — biar `/api/printers` list return fresh saat di-fetch, tapi event broadcast delta → frontend gak perlu re-fetch.

**Step 5: Restart API:**

```bash
pm2 restart printserver-api
```

**Verify:**
```bash
# Trigger IT-99 heartbeat (atau manual call POST /api/clients/3/heartbeat)
# Watch log:
tail -f /root/.pm2/logs/printserver-api-out.log | grep 'printer:'
# Expected: emit "printer:patch" muncul, NOT "printer:update" (yg lama masih ada untuk backward compat)
```

---

### Task 2: Frontend — printers page in-place patch

**File:** `printserver/apps/dashboard/src/app/(dashboard)/printers/page.tsx`

**Step 1: Ganti handler `handlePrinterUpdate` (line 175-178)** dari `fetchPrinters()` jadi in-place patch:

```typescript
// Before (line 174-178):
const handlePrinterUpdate = useCallback(() => {
  fetchPrinters();
  fetchHiddenCount();
}, [fetchPrinters, fetchHiddenCount]);

// After:
const handlePrinterUpdate = useCallback((data?: any) => {
  if (data?.id) {
    // Delta event: patch single row in-place (mirror clients/page.tsx:31-45)
    setPrinters(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p));
  } else {
    // Fallback: no id payload = unknown change, full refetch
    fetchPrinters();
  }
  fetchHiddenCount();
}, [fetchPrinters, fetchHiddenCount]);
```

**Step 2: Tambah listener untuk event delta baru**

Di `useEffect` line 191-204, tambah:

```typescript
on('printer:patch', handlePrinterUpdate);
on('printer:status', handlePrinterUpdate);  // existing event with status only
on('printer:created', (data) => {
  // New printer — patch list (insert if not exist, else update)
  setPrinters(prev => {
    const exists = prev.some(p => p.id === data.id);
    if (exists) return prev.map(p => p.id === data.id ? { ...p, ...data } : p);
    return [...prev, data];
  });
  fetchHiddenCount();
});
on('printer:removed', (data) => {
  setPrinters(prev => prev.filter(p => p.id !== data.id));
  fetchHiddenCount();
});
```

**Step 3: Remove `printer:update` listener** (line 191) — itu full-list re-fetch trigger yang jadi sumber spam:

```typescript
// Hapus line ini:
// on('printer:update', handlePrinterUpdate);
```

Keep `printer-group:*` events (line 194-196) yang pakai `handleGroupUpdate` — itu cuma `setInterval` 1x per 30s badges, low cost.

**Step 4: In-flight de-dup di `fetchPrinters` (line 83-100)**

```typescript
const fetchInFlight = useRef(false);
const fetchPrinters = useCallback(async () => {
  if (fetchInFlight.current) return;  // skip if already running
  fetchInFlight.current = true;
  try {
    // ... existing code
  } finally {
    fetchInFlight.current = false;
  }
}, [showHidden, filterGroup, filterTag]);
```

**Step 5: Build dashboard**

```bash
cd /root/serverbot/print/printserver/apps/dashboard
npm run build 2>&1 | tail -10
```

Note: hang di "Collecting build traces" setelah 15/15 pages = DONE, kill PID.

**Step 6: Restart dashboard**

```bash
pm2 restart printserver-dashboard
```

**Verify:**
- Buka `/printers` di browser
- Buka DevTools Network → jangan ada request `printers` setelah mount
- Tunggu IT-99 heartbeat (5-10 menit) → harusnya cuma 1 event masuk, no `/api/printers` request
- Console: 0 error timeout

---

### Task 3: Frontend — remove `setInterval` polling di 3 page

**File:** `printserver/apps/dashboard/src/app/(dashboard)/page.tsx`

**Step 1: Remove line 371 `setInterval(fetchData, 30000)`**

Ganti jadi:
```typescript
// Before:
// const interval = setInterval(fetchData, 30000);

// After: replace with socket-driven updates
// Existing job:* events (line 374-378) tetap trigger fetchData — itu targeted, not periodic
// Add printer status patch:
on('printer:patch', (data) => {
  // Patch counters in stats card without full refetch
  if (data.status === 'online') setStats((s: any) => ({ ...s, onlinePrinters: s.onlinePrinters + 1 }));
  if (data.status === 'offline') setStats((s: any) => ({ ...s, onlinePrinters: Math.max(0, s.onlinePrinters - 1) }));
});
```

**Step 2: Fallback — jika WS disconnect >5s, aktifkan polling**

```typescript
const [wsHealthy, setWsHealthy] = useState(true);
const wsTimeoutRef = useRef<NodeJS.Timeout>();

useEffect(() => {
  const onConnect = () => {
    setWsHealthy(true);
    clearTimeout(wsTimeoutRef.current);
  };
  const onDisconnect = () => {
    wsTimeoutRef.current = setTimeout(() => setWsHealthy(false), 5000);
  };
  const sock = getSocket();
  sock?.on('connect', onConnect);
  sock?.on('disconnect', onDisconnect);
  return () => {
    sock?.off('connect', onConnect);
    sock?.off('disconnect', onDisconnect);
    clearTimeout(wsTimeoutRef.current);
  };
}, []);

useEffect(() => {
  if (!wsHealthy) {
    const id = setInterval(fetchData, 30000);
    return () => clearInterval(id);
  }
}, [wsHealthy, fetchData]);
```

**Step 3-4: Apply same pattern ke `connect/page.tsx:161` & `clients/[id]/page.tsx:39`**

Polling `connectNodes` (15s) dan `fetchDetail` (15s) hanya aktif kalau `!wsHealthy`.

---

### Task 4: Frontend — keep `Sidebar.tsx` interval tapi raise ke 60s

**File:** `printserver/apps/dashboard/src/components/Sidebar.tsx:80`

`setInterval(fetchBadges, 30_000)` → `setInterval(fetchBadges, 60_000)`. Sidebar badges low-priority, 30s → 60s cukup.

**Verify:** 2 menit idle, request badges harusnya ≤ 1 req (instead of 2).

---

### Task 5: Server — Turunkan axios timeout ke 8s

**File:** `printserver/apps/dashboard/src/lib/api.ts:7`

`timeout: 15000` → `timeout: 8000`. Default axios 0 = no timeout (infinite wait), 15s = kelamaan. 8s cukup untuk response normal (<100ms) dengan buffer untuk cold start.

**Verify:** Build & restart, kalau ada 1.6s spike harusnya gak trigger timeout error lagi.

---

### Task 6: Verify end-to-end

**Step 1:** Trigger IT-99 heartbeat manual (atau tunggu natural).

```bash
# Check API log
tail -f /root/.pm2/logs/printserver-api-out.log | grep printer
```

Expected: `printer:patch` emit, NOT multiple `printer:update` broadcast.

**Step 2:** Check dashboard network tab

Buka `/printers` di browser, biarkan 5 menit.

Expected:
- On mount: 1 request `/api/printers` (initial)
- On IT-99 heartbeat (per ~7 menit): 0 additional requests
- On status change: 0 requests (delta patch in-place)
- Console: 0 timeout errors

**Step 3:** Check API request rate

```bash
# Count /api/printers in 1 minute
tail -1000 /root/.pm2/logs/printserver-api-out.log | grep -c 'GET /api/printers'
```

Expected: ≤ 2 per minute (instead of 600+).

---

## Rollback Plan

Semua perubahan di branch `feat/ws-only-updates`. Kalo produksi rusak:

```bash
cd /root/serverbot/print
git checkout main
pm2 restart printserver-api printserver-dashboard
```

---

## Files Touched

1. `printserver/apps/server/src/routes/clients.ts` (Task 1) — emit granular events
2. `printserver/apps/server/src/routes/printers.ts` (Task 1) — emit on restore/update
3. `printserver/apps/dashboard/src/app/(dashboard)/printers/page.tsx` (Task 2) — in-place patch
4. `printserver/apps/dashboard/src/app/(dashboard)/page.tsx` (Task 3) — remove interval
5. `printserver/apps/dashboard/src/app/(dashboard)/connect/page.tsx` (Task 3) — remove interval
6. `printserver/apps/dashboard/src/app/(dashboard)/clients/[id]/page.tsx` (Task 3) — remove interval
7. `printserver/apps/dashboard/src/components/Sidebar.tsx` (Task 4) — 30s → 60s
8. `printserver/apps/dashboard/src/lib/api.ts` (Task 5) — timeout 15s → 8s

8 files, ~80 lines changed total. Risiko rendah karena tidak ubah schema/response shape — hanya cara dapet data.
