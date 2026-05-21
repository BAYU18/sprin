#!/bin/bash
# ============================================
# PrintServer Pro - Deploy Script
# Untuk Ubuntu Server
# ============================================

set -e

# Warna output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}"
echo "============================================"
echo "   PrintServer Pro - Deployment Script"
echo "============================================"
echo -e "${NC}"

# ============================================
# Cek apakah berjalan sebagai root
# ============================================
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Peringatan: Tidak disarankan menjalankan sebagai root${NC}"
    echo ""
fi

# ============================================
# Cek Docker dan Docker Compose
# ============================================
echo -e "${BLUE}[1/7]${NC} Memeriksa Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker tidak ditemukan. Menginstall Docker...${NC}"
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo -e "${GREEN}Docker berhasil diinstall${NC}"
else
    echo -e "${GREEN}Docker sudah terinstall: $(docker --version)${NC}"
fi

if ! command -v docker compose &> /dev/null && ! docker-compose --version &> /dev/null; then
    echo -e "${RED}Docker Compose tidak ditemukan${NC}"
    exit 1
fi

DOCKER_COMPOSE=$(command -v docker compose &> /dev/null && echo "docker compose" || echo "docker-compose")
echo -e "${GREEN}Docker Compose: $($DOCKER_COMPOSE --version)${NC}"

# ============================================
# Cek file .env
# ============================================
echo ""
echo -e "${BLUE}[2/7]${NC} Memeriksa file konfigurasi..."

ENV_FILE="$(dirname "$0")/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}File .env tidak ditemukan di $(dirname "$0")${NC}"
    echo -e "${YELLOW}Membuat file .env dari template...${NC}"
    if [ -f "$(dirname "$0")/.env.example" ]; then
        cp "$(dirname "$0")/.env.example" "$ENV_FILE"
        echo -e "${YELLOW}Harap edit file .env dan isi JWT_SECRET!${NC}"
        echo -e "${YELLOW}Jalankan: nano $ENV_FILE${NC}"
        exit 1
    else
        exit 1
    fi
fi

# Load environment variables
source "$ENV_FILE"

# Validasi konfigurasi wajib
echo -e "${BLUE}Memvalidasi konfigurasi...${NC}"

if [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
    echo -e "${RED}Error: DB_USER, DB_PASSWORD, DB_NAME harus diset di .env${NC}"
    exit 1
fi

if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" == "ganti-dengan-secret-yang-sangat-panjang-minimal-32-karakter" ]; then
    echo -e "${YELLOW}JWT_SECRET belum diset atau masih default. Generating baru...${NC}"
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" "$ENV_FILE"
    echo -e "${GREEN}JWT_SECRET telah di-generate${NC}"
fi

if [ -z "$REDIS_PASSWORD" ] || [ "$REDIS_PASSWORD" == "redis-password-yang-aman" ]; then
    echo -e "${YELLOW}REDIS_PASSWORD masih default. Generating baru...${NC}"
    REDIS_PASSWORD=$(openssl rand -hex 16)
    sed -i "s/^REDIS_PASSWORD=.*/REDIS_PASSWORD=$REDIS_PASSWORD/" "$ENV_FILE"
    echo -e "${GREEN}REDIS_PASSWORD telah di-generate${NC}"
fi

if [[ "$API_PUBLIC_URL" == *"GANTI_IP_SERVER"* ]]; then
    echo -e "${YELLOW}API_PUBLIC_URL belum diset. Mendeteksi IP server...${NC}"
    SERVER_IP=$(hostname -I | awk '{print $1}')
    if [ -z "$SERVER_IP" ]; then
        SERVER_IP="localhost"
    fi
    sed -i "s|http://GANTI_IP_SERVER_UBUNTU:3000|http://$SERVER_IP:3000|" "$ENV_FILE"
    sed -i "s|http://GANTI_IP_SERVER_UBUNTU:3000|http://$SERVER_IP:3000|" "$ENV_FILE"
    echo -e "${GREEN}URL diset ke: http://$SERVER_IP:3000${NC}"
fi

# ============================================
# Buka Firewall
# ============================================
echo ""
echo -e "${BLUE}[3/7]${NC} Konfigurasi Firewall..."

if command -v ufw &> /dev/null; then
    echo -e "${YELLOW}UFW ditemukan. Membuka port 3000 dan 3001...${NC}"
    sudo ufw allow 3000/tcp 2>/dev/null || true
    sudo ufw allow 3001/tcp 2>/dev/null || true
    echo -e "${GREEN}Port telah dibuka${NC}"
else
    echo -e "${YELLOW}UFW tidak ditemukan. Lewati konfigurasi firewall.${NC}"
    echo -e "${YELLOW}Pastikan port 3000 dan 3001 terbuka secara manual.${NC}"
fi

# ============================================
# Build Docker Images
# ============================================
echo ""
echo -e "${BLUE}[4/7]${NC} Build Docker Images (ini mungkin memakan waktu)..."

cd "$(dirname "$0")"

$DOCKER_COMPOSE build --no-cache api dashboard

echo -e "${GREEN}Build selesai${NC}"

# ============================================
# Start Services
# ============================================
echo ""
echo -e "${BLUE}[5/7]${NC} Menjalankan services..."

$DOCKER_COMPOSE up -d postgres redis

# Tunggu PostgreSQL ready
echo -e "${YELLOW}Menunggu PostgreSQL ready...${NC}"
for i in {1..30}; do
    if $DOCKER_COMPOSE exec -T postgres pg_isready -U "$DB_USER" &> /dev/null; then
        echo -e "${GREEN}PostgreSQL ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}PostgreSQL tidak ready setelah 90 detik${NC}"
        exit 1
    fi
    sleep 3
done

# Start API
$DOCKER_COMPOSE up -d api

# Tunggu API healthy
echo -e "${YELLOW}Menunggu API healthy...${NC}"
for i in {1..30}; do
    if $DOCKER_COMPOSE exec -T api wget -q --spider http://localhost:3000/health &> /dev/null; then
        echo -e "${GREEN}API healthy!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}API tidak healthy setelah 90 detik${NC}"
        echo -e "${YELLOW}Cek logs dengan: docker compose logs api${NC}"
        exit 1
    fi
    sleep 3
done

# Start Dashboard
$DOCKER_COMPOSE up -d dashboard

echo -e "${GREEN}Semua service berjalan${NC}"

# ============================================
# Database Migration
# ============================================
echo ""
echo -e "${BLUE}[6/7]${NC} Running database migration..."

# Buat database jika belum ada
$DOCKER_COMPOSE exec -T postgres psql -U "$DB_USER" -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || true

echo -e "${GREEN}Database ready${NC}"

# ============================================
# Summary
# ============================================
echo ""
echo -e "${BLUE}[7/7]${NC} Deployment selesai!"
echo ""
echo -e "============================================"
echo -e "   ${GREEN}PrintServer Pro Deployed!${NC}"
echo -e "============================================"
echo ""
echo -e "${GREEN}Dashboard:${NC} ${API_PUBLIC_URL}/login"
echo -e "${GREEN}API Health:${NC} ${API_PUBLIC_URL}/health"
echo -e "${GREEN}Metrics:${NC} ${API_PUBLIC_URL}/metrics"
echo ""
echo -e "${YELLOW}Login Default:${NC}"
echo -e "  Username: admin"
echo -e "  Password: changeme123"
echo ""
echo -e "${YELLOW}PENTING: Ganti password setelah login pertama!${NC}"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo -e "  Cek status: ${DOCKER_COMPOSE} ps"
echo -e "  Cek logs:   ${DOCKER_COMPOSE} logs -f"
echo -e "  Restart:    ${DOCKER_COMPOSE} restart"
echo -e "  Stop:       ${DOCKER_COMPOSE} down"
echo ""
echo -e "============================================"