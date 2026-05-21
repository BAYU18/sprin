# PrintServer Pro

## Enterprise Centralized Print Server

Modern print server system that replaces Windows Printer Sharing with a centralized, scalable, real-time print management solution.

### Features

- **Centralized Print Management**: All print jobs routed through a central server
- **Virtual PDF Printer**: Print from any Windows application (Word, Excel, Browser, etc.)
- **Real-time WebSocket**: Live queue updates and printer status
- **Auto Healing**: Automatic failover and retry for failed prints
- **Printer Pooling**: Load balancing across multiple printers
- **User Quotas**: Page limits per user/department
- **Secure Printing**: PIN release, watermarks, audit logs
- **Multi-platform**: Windows, Linux, Docker
- **Scalable**: Designed for 1000+ clients, 200+ printers

### Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Any Windows   │     │  PrintServer    │     │   Physical     │
│  Application   │────▶│  Client Agent   │────▶│   Printers     │
│  (CTRL+P)      │     │  (Electron)     │     │   USB/LAN      │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Central       │
                        │  Print Server  │
                        │  (Node.js)     │
                        └────────┬────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  Web Dashboard │
                        │  (Real-time)   │
                        └─────────────────┘
```

### Tech Stack

**Backend:**
- Node.js 20 LTS
- Fastify (HTTP server)
- Socket.IO (WebSocket)
- BullMQ + Redis (Job queue)
- PostgreSQL (Database)

**Client:**
- Electron.js
- TypeScript
- Chokidar (File watcher)

**Dashboard:**
- Next.js 14
- TailwindCSS
- Recharts
- Socket.IO Client

### Quick Start

#### Using Docker

```bash
cd docker
docker-compose up -d
```

Access:
- Dashboard: http://localhost:3000
- API: http://localhost:3000/api
- Metrics: http://localhost:3000/metrics

Default login: `admin` / `changeme123`

#### Manual Installation

**Server:**
```bash
cd apps/server
npm install
npm run build
npm start
```

**Dashboard:**
```bash
cd apps/dashboard
npm install
npm run build
```

**Client:**
```bash
cd apps/client
npm install
npm run build
```

### Configuration

#### Server (.env)

```env
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/printserver
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-min-32-chars
```

#### Client (config.json)

```json
{
  "serverUrl": "http://printserver:3000",
  "spoolDir": "C:\\PrintServer\\Spool",
  "checkInterval": 5000
}
```

### API Reference

#### Authentication

```
POST /api/auth/login
POST /api/auth/register
POST /api/auth/refresh
```

#### Print Jobs

```
GET  /api/jobs              - List jobs
GET  /api/jobs/:jobId       - Get job details
POST /api/jobs/submit       - Submit new job
POST /api/jobs/:jobId/cancel
POST /api/jobs/:jobId/retry
```

#### Printers

```
GET    /api/printers          - List printers
POST   /api/printers          - Add printer
GET    /api/printers/:id      - Get printer details
PUT    /api/printers/:id      - Update printer
DELETE /api/printers/:id      - Delete printer
GET    /api/printers/:id/status
```

#### Clients

```
GET  /api/clients              - List clients
POST /api/clients/register     - Register client
POST /api/clients/:id/heartbeat
```

#### Analytics

```
GET /api/analytics/overview
GET /api/analytics/volume
GET /api/analytics/printers/usage
GET /api/analytics/users/top
GET /api/analytics/failures
```

### WebSocket Events

**Server → Client:**
- `job:print` - New print job
- `command` - Management command

**Client → Server:**
- `register` - Client registration
- `job:status` - Job status update
- `printer:status` - Printer status

### Monitoring

Prometheus metrics available at `/metrics`:

- `print_jobs_total` - Total print jobs
- `printer_status` - Printer status gauge
- `print_queue_size` - Current queue size
- `active_clients` - Connected clients
- `http_request_duration_seconds` - Request latency

### Virtual Printer Setup

See [docs/virtual-printer-setup.md](docs/virtual-printer-setup.md) for detailed setup instructions.

### Security

- JWT authentication
- RBAC (Role-based access)
- API key support
- Audit logging
- Rate limiting
- HTTPS ready

### License

MIT