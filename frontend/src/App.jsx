import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import Navbar from './components/Navbar.jsx';
import ProcessCard from './components/ProcessCard.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import SystemMonitor from './components/SystemMonitor.jsx';
import ActivityLog from './components/ActivityLog.jsx';

// Determine backend URL: in Vite dev mode with proxy, standard port 8080 or relative
const BACKEND_URL = window.location.port === '5173'
  ? 'http://localhost:8080'
  : window.location.origin;

export default function App() {
  const [connectionState, setConnectionState] = useState('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [workers, setWorkers] = useState({
    Alice: { name: 'Alice', pid: null, online: false, messagesReceived: 0, uptimeSeconds: 0 },
    Bob:   { name: 'Bob',   pid: null, online: false, messagesReceived: 0, uptimeSeconds: 0 }
  });
  const [messages, setMessages] = useState([]);
  const [activities, setActivities] = useState([]);
  const [activeSender, setActiveSender] = useState('Alice');
  const [isSending, setIsSending] = useState(false);
  const [serverInfo, setServerInfo] = useState(null);

  const socketRef = useRef(null);

  // Initialize Socket.IO connection and data polling
  useEffect(() => {
    // 1. Initial REST API load for instant data
    fetch(`${BACKEND_URL}/api/status`)
      .then(res => res.json())
      .then(data => {
        if (data.workers) setWorkers(data.workers);
        setServerInfo(data);
      })
      .catch(() => {});

    fetch(`${BACKEND_URL}/api/messages`)
      .then(res => res.json())
      .then(data => {
        if (data.messages) setMessages(data.messages);
      })
      .catch(() => {});

    fetch(`${BACKEND_URL}/api/activity`)
      .then(res => res.json())
      .then(data => {
        if (data.activities) setActivities(data.activities);
      })
      .catch(() => {});

    // 2. Establish Socket.IO real-time connection
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      setErrorMsg('');
    });

    socket.on('disconnect', (reason) => {
      setConnectionState('disconnected');
      setErrorMsg(reason === 'io server disconnect' ? 'Server disconnected' : 'Connection lost');
    });

    socket.on('connect_error', (err) => {
      setConnectionState('error');
      setErrorMsg(err.message || 'Connection error');
    });

    socket.on('chat:connected', (data) => {
      if (data.workers) setWorkers(data.workers);
      if (data.messages && data.messages.length > 0) setMessages(data.messages);
      if (data.activities && data.activities.length > 0) setActivities(data.activities);
    });

    // Message emitted as "sending" or newly added
    socket.on('chat:message', (newMsg) => {
      setMessages((prev) => {
        const exists = prev.find(m => m.id === newMsg.id);
        if (exists) {
          return prev.map(m => m.id === newMsg.id ? { ...m, ...newMsg } : m);
        }
        return [...prev, newMsg];
      });
    });

    // Message confirmed and acknowledged by receiving C process
    socket.on('chat:delivery', (delivery) => {
      setMessages((prev) => {
        const found = prev.find(m => m.id === delivery.id);
        if (found) {
          return prev.map(m => m.id === delivery.id ? {
            ...m,
            status: 'delivered',
            deliveredAt: delivery.deliveredAt,
            recipientPid: delivery.recipientPid,
            processedCount: delivery.processedCount
          } : m);
        }
        // If not found in current state, append it
        return [...prev, delivery];
      });
      setIsSending(false);
    });

    socket.on('chat:error', (err) => {
      setIsSending(false);
      if (err.id) {
        setMessages((prev) =>
          prev.map(m => m.id === err.id ? { ...m, status: 'failed' } : m)
        );
      }
      setActivities((prev) => [
        {
          id: `err-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'CHAT_ERROR',
          severity: 'error',
          description: err.message || 'IPC dispatch error'
        },
        ...prev
      ]);
    });

    socket.on('process:status', (data) => {
      if (data.workers) {
        setWorkers(data.workers);
      }
    });

    socket.on('activity:event', (event) => {
      setActivities((prev) => [event, ...prev.slice(0, 150)]);
    });

    socket.on('activity:clear', () => {
      setActivities([]);
    });

    // 3. Periodic status polling (updates uptime counters accurately)
    const interval = setInterval(() => {
      fetch(`${BACKEND_URL}/api/status`)
        .then(res => res.json())
        .then(data => {
          if (data.workers) setWorkers(data.workers);
        })
        .catch(() => {});
    }, 4000);

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, []);

  // Send message handler
  const handleSendMessage = ({ from, to, text }) => {
    setIsSending(true);
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Optimistically add to UI in "sending" state
    const optimisticMessage = {
      id: msgId,
      from,
      to,
      text,
      timestamp: new Date().toISOString(),
      status: 'sending',
      recipientPid: workers[to]?.pid
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    // Send via Socket.IO if connected, else fallback to REST POST
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('chat:send', { id: msgId, from, to, text }, (response) => {
        if (!response || !response.success) {
          setIsSending(false);
          setMessages((prev) =>
            prev.map(m => m.id === msgId ? { ...m, status: 'failed' } : m)
          );
        }
      });
    } else {
      // HTTP fallback
      fetch(`${BACKEND_URL}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: msgId, from, to, text })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.message) {
            setMessages((prev) =>
              prev.map(m => m.id === msgId ? data.message : m)
            );
          } else {
            throw new Error(data.error || 'Send failed');
          }
        })
        .catch(() => {
          setMessages((prev) =>
            prev.map(m => m.id === msgId ? { ...m, status: 'failed' } : m)
          );
        })
        .finally(() => {
          setIsSending(false);
        });
    }
  };

  // Restart worker handler
  const handleRestartProcess = async (name) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/processes/${name}/restart`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success && data.process) {
        // Refresh status immediately
        const statusRes = await fetch(`${BACKEND_URL}/api/status`);
        const statusData = await statusRes.json();
        if (statusData.workers) setWorkers(statusData.workers);
      }
    } catch (err) {
      console.error(`Failed to restart ${name}:`, err);
    }
  };

  // Clear activity log handler
  const handleClearActivity = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/activity`, { method: 'DELETE' });
      setActivities([]);
    } catch (err) {
      console.error('Failed to clear activity:', err);
    }
  };

  return (
    <div className="app-container">
      <Navbar
        connectionState={connectionState}
        errorMsg={errorMsg}
        serverInfo={serverInfo}
      />

      <main className="dashboard-grid">
        {/* Process Cards: Alice & Bob */}
        <section className="process-section">
          <ProcessCard
            worker={workers.Alice}
            onRestart={handleRestartProcess}
          />
          <ProcessCard
            worker={workers.Bob}
            onRestart={handleRestartProcess}
          />
        </section>

        {/* Main Workspace: Chat on Left, Monitor & Logs on Right */}
        <section className="main-workspace">
          <ChatWindow
            messages={messages}
            activeSender={activeSender}
            onSenderChange={setActiveSender}
            onSendMessage={handleSendMessage}
            isSending={isSending}
            workers={workers}
          />

          <div className="side-panel-stack">
            <SystemMonitor
              workers={workers}
              serverInfo={serverInfo}
            />

            <ActivityLog
              activities={activities}
              onClear={handleClearActivity}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
