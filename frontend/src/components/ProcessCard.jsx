import React, { useState } from 'react';

export default function ProcessCard({ worker, onRestart }) {
  const [isRestarting, setIsRestarting] = useState(false);

  if (!worker) return null;

  const {
    name,
    pid,
    online,
    uptimeSeconds = 0,
    messagesReceived = 0,
    restarts = 0,
    type = "C / Linux process (ELF)",
    transport = "OS-managed anonymous pipe"
  } = worker;

  const handleRestart = async () => {
    if (isRestarting) return;
    setIsRestarting(true);
    try {
      await onRestart(name);
    } finally {
      setIsRestarting(false);
    }
  };

  const formatUptime = (seconds) => {
    if (!seconds || seconds <= 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className={`process-card ${name.toLowerCase()}`}>
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-icon">{name.charAt(0)}</div>
          <div>
            <h2>Process: {name}</h2>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
              Independent C Executable
            </div>
          </div>
        </div>

        <div className={`status-badge ${online ? 'online' : 'offline'}`}>
          <span className="pulse-dot"></span>
          <span>{online ? 'RUNNING' : 'STOPPED'}</span>
        </div>
      </div>

      <div className="process-metrics">
        <div className="metric-item">
          <span className="metric-label">Linux Process ID</span>
          <span className="metric-value pid-highlight">
            {online && pid ? `PID ${pid}` : 'Offline'}
          </span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Messages Processed</span>
          <span className="metric-value">{messagesReceived}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Process Uptime</span>
          <span className="metric-value">{online ? formatUptime(uptimeSeconds) : '—'}</span>
        </div>

        <div className="metric-item">
          <span className="metric-label">Restarts</span>
          <span className="metric-value">{restarts}</span>
        </div>
      </div>

      <div className="process-details-list">
        <div className="detail-row">
          <span>Binary Type</span>
          <span className="value">{type}</span>
        </div>
        <div className="detail-row">
          <span>IPC Channel</span>
          <span className="value">{transport}</span>
        </div>
        <div className="detail-row">
          <span>File Descriptors</span>
          <span className="value">stdin (0) / stdout (1)</span>
        </div>
      </div>

      <div className="card-actions">
        <button
          className="btn-restart"
          onClick={handleRestart}
          disabled={isRestarting}
          title={`Restart Linux process for ${name}`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
          {isRestarting ? 'Restarting Process...' : `Restart ${name} Process`}
        </button>
      </div>
    </div>
  );
}
