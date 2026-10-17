import React, { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble.jsx';

export default function ChatWindow({
  messages,
  activeSender,
  onSenderChange,
  onSendMessage,
  isSending,
  workers
}) {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef(null);

  const recipient = activeSender === 'Alice' ? 'Bob' : 'Alice';
  const recipientWorker = workers?.[recipient];
  const isRecipientOnline = recipientWorker?.online ?? false;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputText.trim() || isSending || !isRecipientOnline) return;

    onSendMessage({
      from: activeSender,
      to: recipient,
      text: inputText.trim()
    });

    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <h3>IPC Process Communication Channel</h3>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="routing-indicator">
            <span>Route:</span>
            <span className={activeSender.toLowerCase()} style={{ fontWeight: 600 }}>{activeSender}</span>
            <span className="routing-arrow">➔</span>
            <span className={recipient.toLowerCase()} style={{ fontWeight: 600 }}>{recipient}</span>
          </div>

          <div className="sender-switch">
            <button
              type="button"
              className={`sender-btn ${activeSender === 'Alice' ? 'active alice' : ''}`}
              onClick={() => onSenderChange('Alice')}
            >
              Send as Alice
            </button>
            <button
              type="button"
              className={`sender-btn ${activeSender === 'Bob' ? 'active bob' : ''}`}
              onClick={() => onSenderChange('Bob')}
            >
              Send as Bob
            </button>
          </div>
        </div>
      </div>

      <div className="messages-feed">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">💬</div>
            <h4>No Inter-Process Messages Yet</h4>
            <p>
              Type a message below to send data across operating system anonymous pipes to the target C process.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar">
        <form className="chat-form" onSubmit={handleSubmit}>
          <input
            type="text"
            className="chat-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isRecipientOnline
                ? `Write message as ${activeSender} to ${recipient} (PID ${recipientWorker?.pid || '...'})`
                : `Target process ${recipient} is offline. Please restart it above.`
            }
            disabled={!isRecipientOnline || isSending}
            maxLength={2000}
          />

          <button
            type="submit"
            className="btn-send"
            disabled={!inputText.trim() || isSending || !isRecipientOnline}
          >
            {isSending ? (
              <span>Piping...</span>
            ) : (
              <>
                <span>Send</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </>
            )}
          </button>
        </form>

        <div className="chat-input-hints">
          <span>Press Enter to send, Shift+Enter for newline</span>
          <span>Target: {recipient} (fd 0 stdin pipe)</span>
        </div>
      </div>
    </div>
  );
}
