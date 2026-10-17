#!/bin/bash
# tests/ipc_worker_test.sh - Automated tests for C IPC worker
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WORKER_BIN="$PROJECT_ROOT/ipc/chat_worker"
WORKER_SRC="$PROJECT_ROOT/ipc/chat_worker.c"

echo "=========================================================="
echo " Running C IPC Worker Automated Tests"
echo "=========================================================="

# Test 1: Compilation with strict flags
echo -n "[Test 1] Compiling chat_worker.c with -Wall -Wextra -Wpedantic -std=c11... "
gcc -Wall -Wextra -Wpedantic -std=c11 -O2 "$WORKER_SRC" -o "$WORKER_BIN"
if [ -f "$WORKER_BIN" ] && [ -x "$WORKER_BIN" ]; then
    echo "PASSED"
else
    echo "FAILED: Binary not found or not executable"
    exit 1
fi

# Test 2: Startup and PID reporting
echo -n "[Test 2] Verifying Alice startup and real PID reporting... "
STARTUP_LOG=$(mktemp)
echo "" | "$WORKER_BIN" Alice 2> "$STARTUP_LOG" > /dev/null
if grep -q "Process started | PID:" "$STARTUP_LOG" && grep -q "Alice" "$STARTUP_LOG"; then
    PID=$(grep "Process started | PID:" "$STARTUP_LOG" | sed -n 's/.*Process started | PID: \([0-9]*\).*/\1/p')
    if [ -n "$PID" ] && [ "$PID" -gt 0 ]; then
        echo "PASSED (Alice PID: $PID)"
    else
        echo "FAILED: Invalid PID extracted ($PID)"
        rm -f "$STARTUP_LOG"
        exit 1
    fi
else
    echo "FAILED: Expected startup message not found in stderr"
    cat "$STARTUP_LOG"
    rm -f "$STARTUP_LOG"
    exit 1
fi
rm -f "$STARTUP_LOG"

# Test 3: Ping / Pong mechanism
echo -n "[Test 3] Testing ping/pong health probe... "
PONG_OUT=$(echo '{"type":"ping","id":"probe-42"}' | "$WORKER_BIN" Bob 2>/dev/null)
if echo "$PONG_OUT" | grep -q '"type":"pong"' && echo "$PONG_OUT" | grep -q '"id":"probe-42"' && echo "$PONG_OUT" | grep -q '"worker":"Bob"'; then
    echo "PASSED"
else
    echo "FAILED: Unexpected response: $PONG_OUT"
    exit 1
fi

# Test 4: Single message delivery and acknowledgement
echo -n "[Test 4] Sending valid message to Bob and checking ACK... "
MSG_INPUT='{"id":"msg-101","from":"Alice","to":"Bob","text":"Hello Bob from test suite"}'
ACK_OUT=$(echo "$MSG_INPUT" | "$WORKER_BIN" Bob 2>/dev/null)
if echo "$ACK_OUT" | grep -q '"status":"delivered"' && \
   echo "$ACK_OUT" | grep -q '"recipient":"Bob"' && \
   echo "$ACK_OUT" | grep -q '"sender":"Alice"' && \
   echo "$ACK_OUT" | grep -q '"id":"msg-101"'; then
    echo "PASSED"
else
    echo "FAILED: Expected ACK not received: $ACK_OUT"
    exit 1
fi

# Test 5: Multiple sequential messages and counter increment
echo -n "[Test 5] Sending sequential messages to Alice and checking message counter... "
INPUT_STREAM=$(cat <<'EOF'
{"id":"m-1","from":"Bob","to":"Alice","text":"Message 1"}
{"id":"m-2","from":"Bob","to":"Alice","text":"Message 2"}
{"id":"m-3","from":"Bob","to":"Alice","text":"Message 3"}
EOF
)
MULTI_OUT=$(echo "$INPUT_STREAM" | "$WORKER_BIN" Alice 2>/dev/null)
COUNT=$(echo "$MULTI_OUT" | grep -c '"status":"delivered"')
LAST_COUNT=$(echo "$MULTI_OUT" | grep '"id":"m-3"' | grep -o '"processedCount":[0-9]*' | cut -d: -f2)

if [ "$COUNT" -eq 3 ] && [ "$LAST_COUNT" -eq 3 ]; then
    echo "PASSED (Processed 3 sequential messages)"
else
    echo "FAILED: Count mismatch. Total acks: $COUNT, last processedCount: $LAST_COUNT"
    echo "$MULTI_OUT"
    exit 1
fi

# Test 6: Safe handling of invalid / malformed input
echo -n "[Test 6] Sending malformed JSON to Bob (should not crash)... "
MALFORMED_INPUT='{this is not valid json at all}'
ERR_OUT=$(echo "$MALFORMED_INPUT" | "$WORKER_BIN" Bob 2>/dev/null)
if echo "$ERR_OUT" | grep -q '"status":"error"'; then
    echo "PASSED (Worker returned error and remained stable)"
else
    echo "FAILED: Expected error JSON response, got: $ERR_OUT"
    exit 1
fi

# Test 7: Clean EOF termination
echo -n "[Test 7] Testing clean exit on EOF (pipe close)... "
EOF_ERR=$(mktemp)
echo -n "" | "$WORKER_BIN" Alice 2> "$EOF_ERR" > /dev/null
EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ] && grep -q "Pipe closed (EOF)" "$EOF_ERR"; then
    echo "PASSED (Exit code 0, graceful cleanup)"
else
    echo "FAILED: Exit code $EXIT_CODE, expected 0"
    cat "$EOF_ERR"
    rm -f "$EOF_ERR"
    exit 1
fi
rm -f "$EOF_ERR"

echo "=========================================================="
echo " All C IPC Worker tests passed successfully!"
echo "=========================================================="
