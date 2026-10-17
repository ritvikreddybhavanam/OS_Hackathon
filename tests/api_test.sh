#!/bin/bash
# tests/api_test.sh - Automated REST and IPC integration tests
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-8080}"
BASE_URL="http://127.0.0.1:$PORT"

echo "=========================================================="
echo " Running Backend & IPC Integration Automated Tests"
echo " Target: $BASE_URL"
echo "=========================================================="

# Check if backend is running, if not start it in background for testing
STARTED_SERVER=0
if ! curl -s -f "$BASE_URL/api/health" > /dev/null 2>&1; then
    echo "Backend not running on port $PORT. Starting temporary backend..."
    cd "$PROJECT_ROOT/backend"
    node server.js > /tmp/backend_test.log 2>&1 &
    BACKEND_PID=$!
    STARTED_SERVER=1
    
    READY=0
    for i in {1..50}; do
        if curl -s -f "$BASE_URL/api/health" > /dev/null 2>&1; then
            READY=1
            echo "Backend started successfully (PID: $BACKEND_PID)"
            break
        fi
        sleep 0.5
    done

    if [ "$READY" -ne 1 ]; then
        echo "FAILED: Backend failed to become ready within 25s. Log:"
        cat /tmp/backend_test.log
        exit 1
    fi
fi

cleanup() {
    if [ "$STARTED_SERVER" -eq 1 ] && [ -n "$BACKEND_PID" ]; then
        echo "Stopping temporary backend (PID: $BACKEND_PID)..."
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Test 1: Health endpoint
echo -n "[Test 1] Testing GET /api/health... "
HEALTH_RESP=$(curl -s "$BASE_URL/api/health")
if echo "$HEALTH_RESP" | grep -q '"status":"ok"'; then
    echo "PASSED"
else
    echo "FAILED: Unexpected response: $HEALTH_RESP"
    exit 1
fi

# Test 2: Status endpoint & Worker PIDs
echo -n "[Test 2] Testing GET /api/status (Alice & Bob real PIDs)... "
STATUS_RESP=$(curl -s "$BASE_URL/api/status")
ALICE_PID=$(echo "$STATUS_RESP" | grep -o '"Alice":{[^}]*}' | grep -o '"pid":[0-9]*' | cut -d: -f2)
BOB_PID=$(echo "$STATUS_RESP" | grep -o '"Bob":{[^}]*}' | grep -o '"pid":[0-9]*' | cut -d: -f2)

if [ -n "$ALICE_PID" ] && [ "$ALICE_PID" -gt 0 ] && [ -n "$BOB_PID" ] && [ "$BOB_PID" -gt 0 ]; then
    echo "PASSED (Alice PID: $ALICE_PID, Bob PID: $BOB_PID)"
else
    echo "FAILED: Invalid PIDs extracted (Alice: $ALICE_PID, Bob: $BOB_PID)"
    echo "$STATUS_RESP"
    exit 1
fi

# Test 3: Validation - Reject invalid sender/recipient
echo -n "[Test 3] Testing validation (reject invalid sender/recipient)... "
INV_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -d '{"from":"Eve","to":"Bob","text":"Unauthorized"}')
if [ "$INV_RESP" -eq 400 ]; then
    echo "PASSED (HTTP 400 Bad Request)"
else
    echo "FAILED: Expected HTTP 400, got $INV_RESP"
    exit 1
fi

# Test 4: Validation - Reject empty message
echo -n "[Test 4] Testing validation (reject empty text)... "
EMPTY_RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -d '{"from":"Alice","to":"Bob","text":"   "}')
if [ "$EMPTY_RESP" -eq 400 ]; then
    echo "PASSED (HTTP 400 Bad Request)"
else
    echo "FAILED: Expected HTTP 400, got $EMPTY_RESP"
    exit 1
fi

# Test 5: Message delivery Alice -> Bob through OS pipe
echo -n "[Test 5] Sending message Alice -> Bob via OS Pipe... "
MSG1_RESP=$(curl -s -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -d '{"from":"Alice","to":"Bob","text":"Hello Bob! This is an IPC test message."}')

if echo "$MSG1_RESP" | grep -q '"status":"delivered"' && \
   echo "$MSG1_RESP" | grep -q '"recipientPid":'$BOB_PID; then
    echo "PASSED (Delivered and acknowledged by Bob's C process PID $BOB_PID)"
else
    echo "FAILED: Unexpected response: $MSG1_RESP"
    exit 1
fi

# Test 6: Message delivery Bob -> Alice through OS pipe
echo -n "[Test 6] Sending message Bob -> Alice via OS Pipe... "
MSG2_RESP=$(curl -s -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -d '{"from":"Bob","to":"Alice","text":"Message received, Alice! Operating system pipes rock."}')

if echo "$MSG2_RESP" | grep -q '"status":"delivered"' && \
   echo "$MSG2_RESP" | grep -q '"recipientPid":'$ALICE_PID; then
    echo "PASSED (Delivered and acknowledged by Alice's C process PID $ALICE_PID)"
else
    echo "FAILED: Unexpected response: $MSG2_RESP"
    exit 1
fi

# Test 7: Verify session message history
echo -n "[Test 7] Testing GET /api/messages history... "
HIST_RESP=$(curl -s "$BASE_URL/api/messages")
COUNT=$(echo "$HIST_RESP" | grep -o '"count":[0-9]*' | cut -d: -f2)
if [ "$COUNT" -ge 2 ]; then
    echo "PASSED ($COUNT messages in history)"
else
    echo "FAILED: Expected at least 2 messages, got $COUNT"
    exit 1
fi

# Test 8: Worker restart & new PID verification
echo -n "[Test 8] Testing POST /api/processes/Alice/restart... "
RESTART_RESP=$(curl -s -X POST "$BASE_URL/api/processes/Alice/restart")
NEW_ALICE_PID=$(echo "$RESTART_RESP" | grep -o '"pid":[0-9]*' | cut -d: -f2)

if [ -n "$NEW_ALICE_PID" ] && [ "$NEW_ALICE_PID" -gt 0 ] && [ "$NEW_ALICE_PID" -ne "$ALICE_PID" ]; then
    echo "PASSED (Old Alice PID: $ALICE_PID -> New Alice PID: $NEW_ALICE_PID)"
else
    echo "FAILED: Restart failed or PID did not change. Old: $ALICE_PID, New: $NEW_ALICE_PID"
    echo "$RESTART_RESP"
    exit 1
fi

# Test 9: Verify message delivery after restart
echo -n "[Test 9] Sending message Bob -> Alice after restart... "
MSG3_RESP=$(curl -s -X POST "$BASE_URL/api/messages" \
    -H "Content-Type: application/json" \
    -d '{"from":"Bob","to":"Alice","text":"Are you still there after restart?"}')

if echo "$MSG3_RESP" | grep -q '"status":"delivered"' && \
   echo "$MSG3_RESP" | grep -q '"recipientPid":'$NEW_ALICE_PID; then
    echo "PASSED (Delivered to restarted worker with PID $NEW_ALICE_PID)"
else
    echo "FAILED: Delivery failed to restarted worker: $MSG3_RESP"
    exit 1
fi

# Test 10: Activity log endpoint
echo -n "[Test 10] Testing GET and DELETE /api/activity... "
ACT_RESP=$(curl -s "$BASE_URL/api/activity")
if echo "$ACT_RESP" | grep -q '"activities":\['; then
    DEL_RESP=$(curl -s -X DELETE "$BASE_URL/api/activity")
    if echo "$DEL_RESP" | grep -q '"success":true'; then
        echo "PASSED"
    else
        echo "FAILED on DELETE: $DEL_RESP"
        exit 1
    fi
else
    echo "FAILED on GET: $ACT_RESP"
    exit 1
fi

echo "=========================================================="
echo " All Backend & IPC Integration tests passed successfully!"
echo "=========================================================="
