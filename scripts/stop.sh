#!/bin/bash
# scripts/stop.sh - Safely stop IPC Chat application processes
set -e

echo "=========================================================="
echo " Stopping IPC Chat Application Processes"
echo "=========================================================="

STOPPED_ANY=0

# 1. Stop backend on port 8080
if lsof -ti :8080 >/dev/null 2>&1; then
    echo "Stopping backend process listening on port 8080..."
    fuser -k 8080/tcp 2>/dev/null || true
    STOPPED_ANY=1
fi

# 2. Stop frontend on port 5173
if lsof -ti :5173 >/dev/null 2>&1; then
    echo "Stopping frontend process listening on port 5173..."
    fuser -k 5173/tcp 2>/dev/null || true
    STOPPED_ANY=1
fi

# 3. Clean up any remaining C chat_worker processes
if pgrep -f "chat_worker" >/dev/null 2>&1; then
    echo "Stopping Linux C chat_worker processes..."
    killall -9 chat_worker 2>/dev/null || true
    STOPPED_ANY=1
fi

sleep 0.5

if [ $STOPPED_ANY -eq 1 ]; then
    echo "All IPC Chat services stopped cleanly."
else
    echo "No active IPC Chat processes were running."
fi
echo "=========================================================="
