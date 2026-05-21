# PrintServer Pro

Sistem manajemen printer terdistribusi dengan arsitektur **Mobility Print** (mirip PaperCut Mobility Print).

## Arsitektur

```
┌─────────────────────────────────────────────────────────────┐
│                     UBUNTU SERVER                           │
│                  (Central Hub / Print Server)              │
│                                                              │
│  - IPP Server (port 631)     ← menerima print job via AirPrint│
│  - mDNS Advertiser          ← advertise printer ke network  │
│  - PostgreSQL               ← database                     │
│  - Redis (BullMQ)           ← job queue                     │
│  - Dashboard (Next.js)      ← manajemen printer            │
└─────────────────────────────────────────────────────────────┘
                              ↕
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ↓                    ↓                    ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   iPhone/iPad    │  │   Windows PC    │  │   Mac/Android   │
│   (AirPrint)     │  │   (IPP Manual)  │  │   (Auto)        │
└─────────────────┘  └─────────────────┘  └─────────────────┘
                              ↕
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ↓                    ↓                    ↓
┌─────────────────────────────────────────────────────────────┐
│                    WINDOWS NODE AGENT                       │
│                 (PC yang punya printer fisik)                │
│                                                              │
│  - Printer Scanner (WMIC)  ← laporkan printer ke server     │
│  - Job Executor (PowerShell)← eksekusi print job            │
│  - Auto-reconnect          ← koneksi ke Ubuntu             │
└─────────────────────────────────────────────────────────────┘
                              ↕
                      PRINTER FISIK
```

## Fitur Utama

- **AirPrint Support** - iPhone/iPad auto-detect printer
- **mDNS/Bonjour** - Printer muncul otomatis di jaringan
- **IPP Protocol** - Standar printing internasional
- **Multi-Node Support** - Beberapa Windows PC bisa jadi node
- **Auto Failover** - Jika node offline, job dialihkan ke node lain
- **Real-time Monitoring** - Dashboard untuk monitoring semua printer
- **Auto Healing** - Restart spooler otomatis jika error

## Struktur Project

```
printserver/
├── apps/
│   ├── server/           # Node.js API server (Ubuntu)
│   ├── client/            # Electron Windows Node Agent
│   └── dashboard/         # Next.js Dashboard
├── docker/                # Docker Compose untuk Ubuntu
└── scripts/              # Helper scripts
```

## Cara Install

### 1. Setup Ubuntu Server (Central Hub)

```bash
cd printserver/docker

# Edit .env dengan IP server Anda
nano .env

# Start semua services
docker-compose up -d
```

### 2. Setup Windows Node Agent

```powershell
cd apps/client

# Install dependencies
npm install

# Build .exe
npm run build

# Copy hasil ke PC yang punya printer
# Edit .env:
#   IS_CENTRAL=false
#   IS_NODE=true
#   CENTRAL_HUB_URL=http://192.168.1.100:3000
#   NODE_SECRET=rahasia-perusahaan

# Jalankan
npm run dev
```

## Cara Kerja

### Admin:
1. Buka `http://192.168.1.100:3000`
2. Login → Menu Printer
3. Publish printer yang mau di-share

### User (Print):
- **iPhone/iPad**: Buka dokumen → Print → printer muncul otomatis
- **Windows**: Settings → Printers → printer auto-detect atau add manual IPP
- **Mac**: System Settings → Printers → auto-detect

## Environment Variables

### Ubuntu (.env)
```env
IS_CENTRAL=true
IS_NODE=false
SERVER_IP=192.168.1.100
NODE_SECRET=rahasia-perusahaan
```

### Windows Node (.env)
```env
IS_CENTRAL=false
IS_NODE=true
CENTRAL_HUB_URL=http://192.168.1.100:3000
NODE_SECRET=rahasia-perusahaan
NODE_NAME=NODE-LANTAI1
```

## Tech Stack

- **Server**: Node.js + Fastify + BullMQ + PostgreSQL
- **Dashboard**: Next.js 14 + TailwindCSS
- **Client**: Electron
- **Protocol**: IPP (Internet Printing Protocol), mDNS/Bonjour
- **Database**: PostgreSQL
- **Queue**: Redis + BullMQ

## License

MIT