const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const readline = require("readline");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const fs = require("fs");

const PORT = parseInt(process.env.PORT, 10) || 8080;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
const server = http.createServer(app);

// Enable CORS for Express and Socket.IO
app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173", CLIENT_ORIGIN],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  credentials: true
}));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", CLIENT_ORIGIN],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Resolve path to C worker binary
const workerBinary = path.resolve(__dirname, "../ipc/chat_worker");

// In-memory application state
const workers = {
  Alice: { process: null, pid: null, online: false, startTime: null, messagesReceived: 0, restarts: 0, reader: null },
  Bob:   { process: null, pid: null, online: false, startTime: null, messagesReceived: 0, restarts: 0, reader: null }
};

const messageHistory = [];
const activityLogs = [];
const pendingMessages = new Map(); // id -> { resolve, reject, timeoutId, from, to, text }

/**
 * Log system activity to memory and broadcast to connected clients
 */
function logActivity(type, severity, description) {
  const event = {
    id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    type,
    severity: severity || "info", // "info", "success", "warn", "error"
    description
  };

  activityLogs.unshift(event);
  if (activityLogs.length > 200) {
    activityLogs.pop();
  }

  io.emit("activity:event", event);
  console.log(`[ACTIVITY ${event.severity.toUpperCase()}] [${event.type}] ${event.description}`);
  return event;
}

/**
 * Get current workers status summary
 */
function getWorkersSummary() {
  const summary = {};
  const now = Date.now();

  for (const [name, w] of Object.entries(workers)) {
    summary[name] = {
      name,
      pid: w.pid,
      online: w.online,
      startTime: w.startTime ? new Date(w.startTime).toISOString() : null,
      uptimeSeconds: w.online && w.startTime ? Math.floor((now - w.startTime) / 1000) : 0,
      messagesReceived: w.messagesReceived,
      restarts: w.restarts,
      type: "C / Linux process (ELF)",
      transport: "OS-managed anonymous pipe (stdin/stdout)"
    };
  }
  return summary;
}

/**
 * Spawn a C worker process
 */
function startWorker(name) {
  if (!fs.existsSync(workerBinary)) {
    const errorMsg = `Worker binary not found at ${workerBinary}. Run 'make build' first.`;
    console.error(`[FATAL] ${errorMsg}`);
    logActivity("WORKER_ERROR", "error", `Worker executable missing for ${name}: ${workerBinary}`);
    return null;
  }

  try {
    const child = spawn(workerBinary, [name], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const w = workers[name];
    w.process = child;
    w.pid = child.pid;
    w.online = true;
    w.startTime = Date.now();

    logActivity("PROCESS_START", "success", `${name} C process spawned successfully with PID ${child.pid} via OS pipe`);

    // Parse stdout line by line (structured JSON Lines from C worker)
    const reader = readline.createInterface({
      input: child.stdout,
      terminal: false
    });
    w.reader = reader;

    reader.on("line", (line) => {
      handleWorkerStdout(name, line);
    });

    // Capture stderr diagnostics
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        console.log(`[STDERR ${name}] ${text}`);
      }
    });

    // Process exit handler
    child.on("exit", (code, signal) => {
      console.log(`[WORKER EXIT] ${name} (PID ${w.pid}) exited with code ${code}, signal ${signal}`);
      w.online = false;
      const oldPid = w.pid;
      w.pid = null;

      logActivity(
        "PROCESS_EXIT",
        code === 0 ? "info" : "warn",
        `${name} process (PID ${oldPid}) terminated with code ${code ?? signal}`
      );

      // Fail any pending messages waiting for this recipient
      for (const [id, pending] of pendingMessages.entries()) {
        if (pending.to === name) {
          clearTimeout(pending.timeoutId);
          pendingMessages.delete(id);
          pending.reject(new Error(`Worker ${name} exited before acknowledging message.`));
          io.emit("chat:error", {
            id,
            message: `Delivery failed: ${name}'s C process terminated unexpectedly.`
          });
        }
      }

      io.emit("process:status", { workers: getWorkersSummary() });
    });

    child.on("error", (err) => {
      console.error(`[WORKER ERROR] Error in ${name}:`, err.message);
      w.online = false;
      logActivity("WORKER_ERROR", "error", `Process error in ${name}: ${err.message}`);
      io.emit("process:status", { workers: getWorkersSummary() });
    });

    io.emit("process:status", { workers: getWorkersSummary() });
    return child;
  } catch (err) {
    console.error(`[SPAWN ERROR] Failed to start worker ${name}:`, err);
    logActivity("SPAWN_ERROR", "error", `Failed to spawn ${name}: ${err.message}`);
    return null;
  }
}

/**
 * Handle a stdout line received from a C worker
 */
function handleWorkerStdout(workerName, line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const payload = JSON.parse(trimmed);

    if (payload.type === "ack") {
      const msgId = payload.id;
      const recipient = payload.recipient || workerName;
      const recipientPid = payload.recipientPid || workers[recipient]?.pid;

      if (workers[recipient]) {
        workers[recipient].messagesReceived = payload.processedCount || (workers[recipient].messagesReceived + 1);
      }

      logActivity(
        "MESSAGE_ACK",
        "success",
        `IPC Delivery confirmed: ${payload.sender} -> ${recipient} (ACK emitted by PID ${recipientPid}, count: ${workers[recipient]?.messagesReceived})`
      );

      // Match against pending messages
      const pending = pendingMessages.get(msgId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingMessages.delete(msgId);

        const deliveredMsg = {
          id: msgId,
          from: pending.from,
          to: pending.to,
          text: pending.text,
          timestamp: pending.timestamp,
          status: "delivered",
          deliveredAt: new Date().toISOString(),
          recipientPid: recipientPid,
          processedCount: workers[recipient]?.messagesReceived
        };

        messageHistory.push(deliveredMsg);
        if (messageHistory.length > 200) {
          messageHistory.shift();
        }

        // Notify caller if waiting on Promise (HTTP endpoint)
        pending.resolve(deliveredMsg);

        // Broadcast to all connected browsers
        io.emit("chat:delivery", deliveredMsg);
        io.emit("process:status", { workers: getWorkersSummary() });
      } else {
        // Ack for message without pending entry (e.g. earlier reload or broadcast)
        io.emit("chat:delivery", {
          id: msgId,
          recipient,
          recipientPid,
          status: "delivered",
          deliveredAt: new Date().toISOString()
        });
        io.emit("process:status", { workers: getWorkersSummary() });
      }
    } else if (payload.type === "pong") {
      logActivity("PING_PONG", "info", `Received pong health response from ${workerName} (PID ${payload.pid})`);
    } else if (payload.type === "error") {
      logActivity("WORKER_ERROR", "warn", `Worker ${workerName} reported error: ${payload.error}`);
      const pending = pendingMessages.get(payload.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        pendingMessages.delete(payload.id);
        pending.reject(new Error(payload.error || "Worker processing error"));
      }
    }
  } catch (err) {
    console.error(`[PARSE ERROR] Invalid JSON from worker ${workerName}: "${trimmed}"`, err.message);
    logActivity("IPC_PARSE_ERROR", "warn", `Failed to parse JSON line from ${workerName}: "${trimmed.slice(0, 40)}"`);
  }
}

/**
 * Restart a named worker process cleanly
 */
function restartWorker(name) {
  if (!workers[name]) {
    throw new Error(`Invalid process name: ${name}`);
  }

  const w = workers[name];
  const oldPid = w.pid;

  logActivity("PROCESS_RESTART", "info", `Restart requested for ${name} (current PID: ${oldPid ?? "offline"})`);

  // Kill existing process if running
  if (w.process && !w.process.killed && w.process.exitCode === null) {
    try {
      w.process.kill("SIGTERM");
      // Force kill fallback if needed
      setTimeout(() => {
        if (w.process && !w.process.killed && w.process.exitCode === null) {
          w.process.kill("SIGKILL");
        }
      }, 1000).unref();
    } catch (e) {
      console.error(`Error killing worker ${name}:`, e.message);
    }
  }

  w.restarts += 1;
  w.online = false;
  w.pid = null;

  // Short delay to allow OS to clean up pipe file descriptors
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const child = startWorker(name);
      if (child && child.pid) {
        logActivity("PROCESS_RESTART_SUCCESS", "success", `${name} restarted with new PID ${child.pid}`);
        resolve({
          name,
          pid: child.pid,
          restarts: w.restarts,
          online: true
        });
      } else {
        reject(new Error(`Failed to restart worker ${name}`));
      }
    }, 200);
  });
}

/**
 * Dispatch message to recipient C worker via OS pipe
 */
function dispatchMessage({ from, to, text, id }) {
  return new Promise((resolve, reject) => {
    // 1. Validation
    if (!["Alice", "Bob"].includes(from) || !["Alice", "Bob"].includes(to)) {
      return reject(new Error("Invalid sender or recipient. Must be Alice or Bob."));
    }
    if (from === to) {
      return reject(new Error("Sender and recipient must be different processes."));
    }
    if (typeof text !== "string" || !text.trim()) {
      return reject(new Error("Message cannot be empty."));
    }
    if (text.length > 2000) {
      return reject(new Error("Message exceeds maximum length of 2000 characters."));
    }

    const worker = workers[to];
    if (!worker || !worker.online || !worker.process || !worker.process.stdin.writable) {
      return reject(new Error(`Recipient process ${to} is offline or stdin pipe is unavailable.`));
    }

    const msgId = id || `msg-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const timestamp = new Date().toISOString();

    // 2. Setup pending ACK tracking with timeout (5000ms)
    const timeoutId = setTimeout(() => {
      if (pendingMessages.has(msgId)) {
        pendingMessages.delete(msgId);
        logActivity("IPC_TIMEOUT", "error", `Timeout waiting for delivery ACK from ${to} (PID ${worker.pid}) for msg ${msgId}`);
        reject(new Error(`Timeout: Recipient C process ${to} did not acknowledge message within 5s.`));
      }
    }, 5000);

    pendingMessages.set(msgId, {
      resolve,
      reject,
      timeoutId,
      from,
      to,
      text: text.trim(),
      timestamp
    });

    // 3. Emit "sending" message event to clients so UI immediately shows pending status
    const pendingMsg = {
      id: msgId,
      from,
      to,
      text: text.trim(),
      timestamp,
      status: "sending",
      recipientPid: worker.pid
    };
    io.emit("chat:message", pendingMsg);

    logActivity("MESSAGE_SUBMIT", "info", `Writing to OS pipe stdin of ${to} (PID ${worker.pid}): "${text.trim().slice(0, 40)}"`);

    // 4. Construct JSON payload for C worker
    const payload = JSON.stringify({
      id: msgId,
      from,
      to,
      text: text.trim(),
      timestamp
    }) + "\n";

    // 5. Write to C worker's stdin pipe
    worker.process.stdin.write(payload, "utf8", (err) => {
      if (err) {
        clearTimeout(timeoutId);
        pendingMessages.delete(msgId);
        logActivity("PIPE_WRITE_ERROR", "error", `Pipe write error to ${to}: ${err.message}`);
        reject(new Error(`OS pipe write failed: ${err.message}`));
      }
    });
  });
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

// Health endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    os: `${os.type()} ${os.release()} (${os.arch()})`
  });
});

// Status endpoint
app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    os: "Ubuntu Linux (WSL2)",
    ipcMechanism: "OS-managed anonymous pipes (stdin/stdout)",
    architecture: "Browser (Socket.IO) -> Express Relay -> Linux C Child Processes (Alice & Bob)",
    workers: getWorkersSummary(),
    serverUptime: Math.floor(process.uptime()),
    totalMessages: messageHistory.length,
    activeConnections: io.engine.clientsCount
  });
});

// Messages history endpoint
app.get("/api/messages", (req, res) => {
  res.json({
    messages: messageHistory,
    count: messageHistory.length
  });
});

// Activity log endpoint
app.get("/api/activity", (req, res) => {
  res.json({
    activities: activityLogs,
    count: activityLogs.length
  });
});

// Clear activity log endpoint
app.delete("/api/activity", (req, res) => {
  activityLogs.length = 0;
  logActivity("ACTIVITY_CLEARED", "info", "Activity log cleared by user");
  io.emit("activity:clear", { success: true });
  res.json({ success: true, message: "Activity log cleared" });
});

// Process restart endpoint
app.post("/api/processes/:name/restart", async (req, res) => {
  const { name } = req.params;
  if (!["Alice", "Bob"].includes(name)) {
    return res.status(400).json({ error: "Invalid process name. Must be Alice or Bob." });
  }

  try {
    const result = await restartWorker(name);
    res.json({
      success: true,
      message: `Process ${name} restarted successfully`,
      process: result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HTTP message submission endpoint (alternative to Socket.IO)
app.post("/api/messages", async (req, res) => {
  const { from, to, text, id } = req.body;
  try {
    const delivered = await dispatchMessage({ from, to, text, id });
    res.status(201).json({
      success: true,
      message: delivered
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

// ==========================================
// SOCKET.IO EVENT HANDLERS
// ==========================================

io.on("connection", (socket) => {
  console.log(`[SOCKET CONNECT] Client connected: ${socket.id}`);
  logActivity("CLIENT_CONNECT", "info", `Browser client connected (ID: ${socket.id.slice(0, 8)})`);

  // Initial welcome payload
  socket.emit("chat:connected", {
    message: "Connected to IPC Chat Ubuntu Backend",
    serverTime: new Date().toISOString(),
    workers: getWorkersSummary(),
    messages: messageHistory,
    activities: activityLogs.slice(0, 50)
  });

  // Client requests message dispatch
  socket.on("chat:send", async (data = {}, callback) => {
    try {
      const delivered = await dispatchMessage(data);
      if (typeof callback === "function") {
        callback({ success: true, message: delivered });
      }
    } catch (err) {
      socket.emit("chat:error", {
        id: data.id,
        message: err.message
      });
      if (typeof callback === "function") {
        callback({ success: false, error: err.message });
      }
    }
  });

  // Client requests process restart
  socket.on("process:restart", async ({ processName }, callback) => {
    if (!["Alice", "Bob"].includes(processName)) {
      const err = "Invalid process name. Choose Alice or Bob.";
      socket.emit("chat:error", { message: err });
      if (typeof callback === "function") callback({ success: false, error: err });
      return;
    }

    try {
      const result = await restartWorker(processName);
      if (typeof callback === "function") callback({ success: true, process: result });
    } catch (err) {
      socket.emit("chat:error", { message: err.message });
      if (typeof callback === "function") callback({ success: false, error: err.message });
    }
  });

  // Client clears activity log
  socket.on("activity:clear", () => {
    activityLogs.length = 0;
    logActivity("ACTIVITY_CLEARED", "info", "Activity log cleared by client");
    io.emit("activity:clear", { success: true });
  });

  socket.on("disconnect", (reason) => {
    console.log(`[SOCKET DISCONNECT] Client disconnected: ${socket.id} (${reason})`);
    logActivity("CLIENT_DISCONNECT", "info", `Browser client disconnected (${reason})`);
  });
});

// ==========================================
// INITIALIZATION & SHUTDOWN
// ==========================================

server.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("  IPC CHAT — INTER-PROCESS COMMUNICATION SERVER");
  console.log("==================================================");
  console.log(`  Backend URL:    http://localhost:${PORT}`);
  console.log(`  Health Check:   http://localhost:${PORT}/api/health`);
  console.log(`  System Status:  http://localhost:${PORT}/api/status`);
  console.log(`  Messages API:   http://localhost:${PORT}/api/messages`);

  logActivity("SYSTEM_INIT", "info", "Backend initialized. Spawning Alice and Bob Linux C workers...");
  startWorker("Alice");
  startWorker("Bob");

  console.log(`  Alice Worker:   PID ${workers.Alice?.pid || "offline"}`);
  console.log(`  Bob Worker:     PID ${workers.Bob?.pid || "offline"}`);
  console.log("==================================================");
  logActivity("SYSTEM_READY", "success", `IPC Chat server ready on port ${PORT}`);
});

function shutdown() {
  console.log("\n[SHUTDOWN] Terminating IPC Chat server...");
  logActivity("SYSTEM_SHUTDOWN", "warn", "Server shutdown initiated. Cleaning up child processes.");

  for (const [name, w] of Object.entries(workers)) {
    if (w.process && !w.process.killed && w.process.exitCode === null) {
      console.log(`[SHUTDOWN] Sending SIGTERM to ${name} (PID ${w.pid})...`);
      try {
        w.process.kill("SIGTERM");
      } catch (e) {
        // ignore
      }
    }
  }

  server.close(() => {
    console.log("[SHUTDOWN] HTTP server closed.");
    process.exit(0);
  });

  // Emergency exit timer
  setTimeout(() => {
    console.error("[SHUTDOWN] Forcing exit after timeout.");
    process.exit(1);
  }, 3000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
