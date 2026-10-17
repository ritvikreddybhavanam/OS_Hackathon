import React from 'react';

export default function SystemMonitor({ workers, serverInfo }) {
  const alice = workers?.Alice;
  const bob = workers?.Bob;

  return (
    <div className="monitor-panel">
      <div className="panel-header">
        <h3>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
          IPC Kernel Pipeline Architecture
        </h3>
        <span className="badge-tag">OS Anonymous Pipes</span>
      </div>

      <div className="ipc-pipeline-card">
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          Physical Flow of Inter-Process Data:
        </div>

        <div className="pipeline-diagram">
          <div className="pipeline-node">
            <div className="node-title">Client</div>
            <div className="node-name">Browser UI</div>
          </div>

          <div className="pipeline-connector">
            <span>ws://</span>
            <span className="connector-arrow">➔</span>
          </div>

          <div className="pipeline-node">
            <div className="node-title">Relay Host</div>
            <div className="node-name">Node.js</div>
          </div>

          <div className="pipeline-connector">
            <span>pipe()</span>
            <span className="connector-arrow">➔</span>
          </div>

          <div className="pipeline-node" style={{ borderColor: 'var(--accent-alice)' }}>
            <div className="node-title">Linux Process</div>
            <div className="node-name" style={{ color: 'var(--accent-alice)' }}>
              Alice {alice?.pid ? `(${alice.pid})` : ''}
            </div>
          </div>

          <div className="pipeline-connector">
            <span>pipe()</span>
            <span className="connector-arrow">➔</span>
          </div>

          <div className="pipeline-node" style={{ borderColor: 'var(--accent-bob)' }}>
            <div className="node-title">Linux Process</div>
            <div className="node-name" style={{ color: 'var(--accent-bob)' }}>
              Bob {bob?.pid ? `(${bob.pid})` : ''}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.75rem', fontSize: '0.72rem' }}>
          <div style={{ background: 'var(--bg-card)', padding: '0.5rem', borderRadius: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Channel: </span>
            <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>Anonymous Unix Pipe</span>
          </div>
          <div style={{ background: 'var(--bg-card)', padding: '0.5rem', borderRadius: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Protocol: </span>
            <span style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>JSON Lines (\\n)</span>
          </div>
        </div>
      </div>

      <div className="viva-note">
        <strong>OS Viva Reference:</strong> In Unix-like operating systems, an anonymous pipe is a unidirectional IPC channel provided by the kernel via the <code>pipe()</code> system call. The Node.js parent process spawns two child processes using <code>fork()</code> + <code>exec()</code>, attaching stdin (fd 0) and stdout (fd 1) to kernel pipe buffers. When a message is sent, data is copied into the kernel pipe buffer and read by the recipient C process, which computes and returns a delivery ACK with its real Linux PID.
      </div>
    </div>
  );
}
