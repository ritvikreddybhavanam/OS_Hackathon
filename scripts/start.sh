#!/bin/bash
# scripts/start.sh - Single-command launcher for IPC Chat on Ubuntu WSL2
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOGS_DIR="$PROJECT_ROOT/logs"

mkdir -p "$LOGS_DIR"

echo "=========================================================="
echo " Starting IPC Chat — Inter-Process Communication in Real Time"
echo "=========================================================="

# 1. Environment verification
echo -n "[1/5] Checking prerequisites (gcc, node, npm)... "
if ! command -v gcc >/dev/null 2>&1; then
    echo "FAILED: 'gcc' not found. Please install build-essential."
    exit 1
fi
if ! command -v node >/dev/null 2>&1; then
    echo "FAILED: 'node' not found. Please install Node.js."
    exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
    echo "FAILED: 'npm' not found. Please install npm."
    exit 1
fi
echo "OK (gcc $(gcc -dumpversion), node $(node -v), npm $(npm -v))"

# 2. Port conflict detection & cleanup
echo -n "[2/5] Checking ports (8080, 5173)... "
if lsof -ti :8080 >/dev/null 2>&1; then
    echo ""
    echo "Notice: Port 8080 is currently occupied. Cleaning up existing process..."
    fuser -k 8080/tcp 2>/dev/null || true
    sleep 1
fi
if lsof -ti :5173 >/dev/null 2>&1; then
    echo "Notice: Port 5173 is currently occupied. Cleaning up existing process..."
    fuser -k 5173/tcp 2>/dev/null || true
    sleep 1
fi
echo "OK (Ports free)"

# 3. Compile C IPC Worker
echo -n "[3/5] Compiling Linux C chat_worker... "
gcc -Wall -Wextra -Wpedantic -std=c11 -O2 "$PROJECT_ROOT/ipc/chat_worker.c" -o "$PROJECT_ROOT/ipc/chat_worker"
echo "OK ($PROJECT_ROOT/ipc/chat_worker)"

# 4. Check dependencies
if [ ! -d "$PROJECT_ROOT/backend/node_modules" ]; then
    echo "Installing backend dependencies..."
    (cd "$PROJECT_ROOT/backend" && npm install)
fi
if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
    echo "Installing frontend dependencies..."
    (cd "$PROJECT_ROOT/frontend" && npm install)
fi

# 5. Launch Backend
echo "[4/5] Starting Node.js backend relay on port 8080..."
cd "$PROJECT_ROOT/backend"
node server.js > "$LOGS_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for backend health check
READY=0
for i in {1..50}; do
    if curl -s -f "http://127.0.0.1:8080/api/health" > /dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 0.5
done

if [ $READY -ne 1 ]; then
    echo "ERROR: Backend failed to become ready within 25 seconds. Check $LOGS_DIR/backend.log"
    cat "$LOGS_DIR/backend.log"
    kill $BACKEND_PID 2>/dev/null || true
    exit 1
fi

STATUS_DATA=$(curl -s "http://localhost:8080/api/status")
ALICE_PID=$(echo "$STATUS_DATA" | grep -o '"Alice":{[^}]*}' | grep -o '"pid":[0-9]*' | cut -d: -f2)
BOB_PID=$(echo "$STATUS_DATA" | grep -o '"Bob":{[^}]*}' | grep -o '"pid":[0-9]*' | cut -d: -f2)

echo "Backend ready! Real Linux Workers spawned:"
echo "  • Alice Worker: Linux Process PID $ALICE_PID"
echo "  • Bob Worker:   Linux Process PID $BOB_PID"

# 6. Launch Frontend
echo "[5/5] Starting Vite frontend dashboard on port 5173..."
cd "$PROJECT_ROOT/frontend"
npm run dev -- --host 0.0.0.0 > "$LOGS_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

# Graceful cleanup trap
cleanup() {
    echo ""
    echo "Received shutdown signal. Stopping services..."
    kill $FRONTEND_PID 2>/dev/null || true
    kill $BACKEND_PID 2>/dev/null || true
    "$PROJECT_ROOT/scripts/stop.sh" >/dev/null 2>&1 || true
    echo "IPC Chat shutdown complete."
    exit 0
}
trap cleanup INT TERM EXIT

echo ""
echo "=========================================================="
echo "  🚀 IPC CHAT IS RUNNING SUCCESSFULLY!"
echo "=========================================================="
echo "  🌐 Frontend Dashboard: http://localhost:5173"
echo "  🩺 Backend Health:      http://localhost:8080/api/health"
echo "  📊 Process Status:     http://localhost:8080/api/status"
echo "  📜 Logs Directory:     $LOGS_DIR"
echo "=========================================================="
echo "  Alice PID: $ALICE_PID (fd 0/1 pipes)"
echo "  Bob PID:   $BOB_PID (fd 0/1 pipes)"
echo "  Press Ctrl+C to stop all processes gracefully."
echo "=========================================================="

# Keep alive while both processes are running
while kill -0 $BACKEND_PID 2>/dev/null && kill -0 $FRONTEND_PID 2>/dev/null; do
    sleep 1
done
