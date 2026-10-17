import React from 'react';

export default function ActivityLog({ activities, onClear }) {
  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
    } catch {
      return '';
    }
  };

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Real-Time OS Activity Log</h3>
          <span className="badge-tag" style={{ padding: '0.15rem 0.45rem', fontSize: '0.68rem' }}>
            {activities.length} Events
          </span>
        </div>

        <button className="btn-clear" onClick={onClear} title="Clear visible logs">
          Clear Log
        </button>
      </div>

      <div className="activity-feed">
        {activities.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            No activity logged yet.
          </div>
        ) : (
          activities.map((act) => (
            <div key={act.id} className="activity-entry">
              <span className={`entry-severity ${act.severity || 'info'}`}>
                {act.severity || 'INFO'}
              </span>
              <div className="entry-content">
                <span className="entry-desc">{act.description}</span>
                <span className="entry-time">{formatTime(act.timestamp)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
