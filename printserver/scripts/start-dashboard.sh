#!/bin/bash
# PrintServer Pro Dashboard launcher for PM2

set -e
cd /root/serverbot/print/printserver/apps/dashboard

export NODE_ENV=production
export NEXT_PUBLIC_API_URL='http://192.168.170.58:3000'
export NEXT_PUBLIC_WS_URL='ws://192.168.170.58:3000'

exec ./node_modules/.bin/next start -p 3001
