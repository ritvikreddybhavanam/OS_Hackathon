import React from 'react';

export default function MessageBubble({ message }) {
  if (!message) return null;

  const {
    from,
    to,
    text,
    timestamp,
    status = 'delivered',
    recipientPid
  } = message;

  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  const isFromAlice = from === 'Alice';

  return (
    <div className={`message-bubble ${isFromAlice ? 'from-alice' : 'from-bob'}`}>
      <div className="bubble-meta">
        <div className="bubble-actors">
          <span className={`actor-sender ${from.toLowerCase()}`}>{from}</span>
          <span style={{ color: 'var(--text-muted)' }}>➔</span>
          <span className={`actor-recipient ${to.toLowerCase()}`}>{to}</span>
        </div>
        <span className="bubble-time">{formatTime(timestamp)}</span>
      </div>

      <div className="bubble-text">{text}</div>

      <div className="bubble-footer">
        <div className="pid-tag">
          {recipientPid ? (
            <span>Handled by {to} (PID {recipientPid})</span>
          ) : (
            <span>Routing via OS pipe</span>
          )}
        </div>

        <div className={`delivery-badge ${status}`}>
          {status === 'delivered' && (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>Delivered (Pipe Ack)</span>
            </>
          )}

          {status === 'sending' && (
            <>
              <span className="pulse-dot" style={{ width: 6, height: 6 }}></span>
              <span>Sending via pipe...</span>
            </>
          )}

          {status === 'failed' && (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="15" y1="9" x2="9" y2="15"></line>
                <line x1="9" y1="9" x2="15" y2="15"></line>
              </svg>
              <span>Failed</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
