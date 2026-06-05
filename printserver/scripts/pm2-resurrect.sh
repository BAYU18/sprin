#!/bin/bash
# Resurrect PM2 processes on boot (fallback for systems without systemd hook)
export PATH=/root/.npm-global/bin:$PATH
exec pm2 resurrect
