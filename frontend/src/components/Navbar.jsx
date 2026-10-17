import React from 'react';

export default function Navbar({ connectionState, errorMsg, serverInfo }) {
  const getStatusClass = () => {
    switch (connectionState) {
      case 'connected': return 'connected';
      case 'connecting': return 'connecting';
      default: return 'disconnected';
    }
  };

  const getStatusLabel = () => {
    switch (connectionState) {
      case 'connected': return 'Socket.IO Connected';
      case 'connecting': return 'Connecting to Host...';
      default: return errorMsg || 'Disconnected from Server';
    }
  };

  return (
    <header className="navbar">
      <div className="nav-brand">
        <div className="brand-icon" title="IPC OS Kernel Pipes">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
            <line x1="6" y1="6" x2="6.01" y2="6"></line>
            <line x1="6" y1="18" x2="6.01" y2="18"></line>
          </svg>
        </div>
        <div className="brand-titles">
          <h1>
            IPC Chat <span className="highlight">— Real-Time OS IPC</span>
          </h1>
          <p>Demonstrating Inter-Process Communication via OS Pipes in Ubuntu Linux</p>
        </div>
      </div>

      <div className="nav-status">
        <div className="badge-tag" title="Running natively in Linux WSL2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 17l6-6-6-6"></path>
            <path d="M12 19h8"></path>
          </svg>
          <span>Ubuntu WSL2 Linux</span>
        </div>

        <div className="badge-tag" title="IPC mechanism">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M8 12h8"></path>
            <path d="M12 8v8"></path>
          </svg>
          <span>OS Pipes (stdin/stdout)</span>
        </div>

        <div className={`connection-pill ${getStatusClass()}`} title="Live Socket.IO connection status">
          <span className="pulse-dot"></span>
          <span>{getStatusLabel()}</span>
        </div>
      </div>
    </header>
  );
}
