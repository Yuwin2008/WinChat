import { useState, useEffect, useRef, useCallback } from "react";

const CHANNEL_NAME = "realtime_chat_v1";
const STORAGE_KEY = "chat_messages_v1";
const USERS_KEY = "chat_users_v1";

const COLORS = [
  { bg: "#E6F1FB", text: "#0C447C", border: "#378ADD" },
  { bg: "#E1F5EE", text: "#085041", border: "#1D9E75" },
  { bg: "#FAECE7", text: "#4A1B0C", border: "#D85A30" },
  { bg: "#FBEAF0", text: "#4B1528", border: "#D4537E" },
  { bg: "#EEEDFE", text: "#26215C", border: "#7F77DD" },
  { bg: "#FAEEDA", text: "#412402", border: "#BA7517" },
];

function getColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name) {
  return name.split(" ").map(p => p[0]).join("").toUpperCase().slice(0, 2);
}

function timeStr(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function loadMessages() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
}

function saveMessages(msgs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-200))); } catch { }
}

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || "{}"); } catch { return {}; }
}

function saveUsers(users) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch { }
}

const adjectives = ["Swift", "Cosmic", "Electric", "Neon", "Vibrant", "Stellar", "Rapid", "Vivid"];
const nouns = ["Fox", "Panda", "Comet", "Spark", "Wave", "Lynx", "Orbit", "Nova"];
function randomName() {
  return adjectives[Math.floor(Math.random() * adjectives.length)] + " " +
    nouns[Math.floor(Math.random() * nouns.length)];
}

export default function ChatApp() {
  const [userId] = useState(() => {
    let id = sessionStorage.getItem("chat_uid");
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("chat_uid", id); }
    return id;
  });
  const [userName, setUserName] = useState(() => {
    const users = loadUsers();
    let id = sessionStorage.getItem("chat_uid") || userId;
    return users[id] || randomName();
  });
  const [messages, setMessages] = useState(() => loadMessages());
  const [input, setInput] = useState("");
  const [onlineUsers, setOnlineUsers] = useState({});
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userName);
  const [typing, setTyping] = useState({});
  const [joined, setJoined] = useState(false);

  const channelRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimerRef = useRef({});
  const heartbeatRef = useRef(null);
  const color = getColor(userId);

  const broadcast = useCallback((data) => {
    channelRef.current?.postMessage(data);
  }, []);

  useEffect(() => {
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);

    channelRef.current.onmessage = (e) => {
      const { type, payload } = e.data;

      if (type === "message") {
        setMessages(prev => {
          const updated = [...prev, payload];
          saveMessages(updated);
          return updated;
        });
      }
      if (type === "presence") {
        setOnlineUsers(prev => ({
          ...prev,
          [payload.userId]: { name: payload.name, ts: Date.now() }
        }));
      }
      if (type === "user_update") {
        setOnlineUsers(prev => ({
          ...prev,
          [payload.userId]: { name: payload.name, ts: Date.now() }
        }));
        setMessages(prev => prev.map(m =>
          m.userId === payload.userId ? { ...m, userName: payload.name } : m
        ));
      }
      if (type === "typing") {
        if (payload.userId === userId) return;
        setTyping(prev => ({ ...prev, [payload.userId]: payload.name }));
        clearTimeout(typingTimerRef.current[payload.userId]);
        typingTimerRef.current[payload.userId] = setTimeout(() => {
          setTyping(prev => { const n = { ...prev }; delete n[payload.userId]; return n; });
        }, 2000);
      }
      if (type === "clear") {
        setMessages([]);
        saveMessages([]);
      }
    };

    heartbeatRef.current = setInterval(() => {
      broadcast({ type: "presence", payload: { userId, name: userName } });
      setOnlineUsers(prev => {
        const now = Date.now();
        const updated = {};
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.ts < 6000) updated[k] = v;
        }
        return updated;
      });
    }, 2500);

    broadcast({ type: "presence", payload: { userId, name: userName } });

    const users = loadUsers();
    users[userId] = userName;
    saveUsers(users);

    return () => {
      channelRef.current?.close();
      clearInterval(heartbeatRef.current);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const msg = {
      id: crypto.randomUUID(),
      userId,
      userName,
      text,
      ts: Date.now(),
    };
    broadcast({ type: "message", payload: msg });
    setMessages(prev => {
      const updated = [...prev, msg];
      saveMessages(updated);
      return updated;
    });
    setInput("");
    inputRef.current?.focus();
  }, [input, userId, userName, broadcast]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    broadcast({ type: "typing", payload: { userId, name: userName } });
  };

  const saveName = () => {
    const n = nameInput.trim() || userName;
    setUserName(n);
    setEditingName(false);
    const users = loadUsers();
    users[userId] = n;
    saveUsers(users);
    broadcast({ type: "user_update", payload: { userId, name: n } });
  };

  const clearChat = () => {
    broadcast({ type: "clear", payload: {} });
    setMessages([]);
    saveMessages([]);
  };

  const totalOnline = Object.keys(onlineUsers).length + 1;
  const typingNames = Object.values(typing);

  if (!joined) {
    return (
      <div style={{
        minHeight: 520,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 24,
        padding: "2rem"
      }}>
        <h2 style={{ sr: "only", fontSize: 22, fontWeight: 500, margin: 0, color: "var(--color-text-primary)" }}>
          WinChat - A Real-Time Chat App Using BroadcastChannel API By
          Yuwin_2407
          
        </h2>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0, textAlign: "center", maxWidth: 320 }}>
          Open this page in multiple tabs to chat in real time — no server needed.
        </p>
        <div style={{
          background: "var(--color-background-primary)",
          border: "0.5px solid var(--color-border-tertiary)",
          borderRadius: "var(--border-radius-lg)",
          padding: "1.5rem",
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 16
        }}>
          <label style={{ fontSize: 13, color: "var(--color-text-secondary)", marginBottom: -8 }}>Your display name</label>
          <input
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && setJoined(true)}
            style={{ width: "100%", boxSizing: "border-box" }}
            placeholder="Enter a name..."
            autoFocus
          />
          <button
            onClick={() => { setUserName(nameInput.trim() || userName); setJoined(true); }}
            style={{ width: "100%", padding: "10px 0", fontSize: 14, cursor: "pointer", fontWeight: 500 }}
          >
            Join chat →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 560, fontFamily: "var(--font-sans)" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderBottom: "0.5px solid var(--color-border-tertiary)",
        background: "var(--color-background-primary)",
        flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#1D9E75", flexShrink: 0
          }} />
          <span style={{ fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }}>General</span>
          <span style={{
            fontSize: 12, color: "var(--color-text-secondary)",
            background: "var(--color-background-secondary)",
            border: "0.5px solid var(--color-border-tertiary)",
            borderRadius: "var(--border-radius-md)",
            padding: "2px 8px"
          }}>
            {totalOnline} {totalOnline === 1 ? "person" : "people"} here
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {editingName ? (
            <>
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                style={{ fontSize: 13, padding: "4px 8px", width: 130 }}
                autoFocus
              />
              <button onClick={saveName} style={{ fontSize: 12, padding: "4px 10px", cursor: "pointer" }}>Save</button>
            </>
          ) : (
            <button
              onClick={() => { setNameInput(userName); setEditingName(true); }}
              style={{ fontSize: 12, padding: "4px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
              title="Change name"
            >
              <i className="ti ti-edit" style={{ fontSize: 14 }} aria-hidden="true" />
              {userName}
            </button>
          )}
          <button
            onClick={clearChat}
            style={{ fontSize: 12, padding: "4px 10px", cursor: "pointer", color: "var(--color-text-secondary)" }}
            title="Clear all messages"
          >
            <i className="ti ti-trash" style={{ fontSize: 14 }} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        background: "var(--color-background-tertiary)"
      }}>
        {messages.length === 0 && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 8, color: "var(--color-text-tertiary)"
          }}>
            <i className="ti ti-messages" style={{ fontSize: 32 }} aria-hidden="true" />
            <p style={{ fontSize: 14, margin: 0 }}>No messages yet. Say hello!</p>
            <p style={{ fontSize: 12, margin: 0 }}>Open another tab to start a real-time conversation.</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isMe = msg.userId === userId;
          const mColor = getColor(msg.userId);
          const prevMsg = messages[i - 1];
          const showHeader = !prevMsg || prevMsg.userId !== msg.userId || (msg.ts - prevMsg.ts > 60000);

          return (
            <div key={msg.id} style={{
              display: "flex",
              flexDirection: isMe ? "row-reverse" : "row",
              alignItems: "flex-end",
              gap: 8,
              marginTop: showHeader ? 12 : 2
            }}>
              {!isMe && showHeader && (
                <div style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: mColor.bg, border: `1.5px solid ${mColor.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 500, color: mColor.text, flexShrink: 0
                }}>
                  {initials(msg.userName)}
                </div>
              )}
              {!isMe && !showHeader && <div style={{ width: 28, flexShrink: 0 }} />}

              <div style={{ maxWidth: "72%", display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start" }}>
                {showHeader && (
                  <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginBottom: 4, paddingLeft: isMe ? 0 : 2, paddingRight: isMe ? 2 : 0 }}>
                    {isMe ? "You" : msg.userName} · {timeStr(msg.ts)}
                  </span>
                )}
                <div style={{
                  background: isMe ? mColor.bg : "var(--color-background-primary)",
                  border: isMe ? `1.5px solid ${mColor.border}` : "0.5px solid var(--color-border-tertiary)",
                  borderRadius: isMe
                    ? "14px 14px 4px 14px"
                    : "14px 14px 14px 4px",
                  padding: "8px 12px",
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: isMe ? mColor.text : "var(--color-text-primary)",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap"
                }}>
                  {msg.text}
                </div>
              </div>
            </div>
          );
        })}

        {typingNames.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingLeft: 36 }}>
            <div style={{ display: "flex", gap: 3 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--color-text-tertiary)",
                  display: "inline-block",
                  animation: `bounce 1.2s ${i * 0.2}s infinite`
                }} />
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{
        padding: "10px 12px",
        borderTop: "0.5px solid var(--color-border-tertiary)",
        background: "var(--color-background-primary)",
        display: "flex",
        gap: 8,
        alignItems: "flex-end",
        flexShrink: 0
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Message General… (Enter to send, Shift+Enter for newline)"
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            fontSize: 14,
            lineHeight: 1.5,
            padding: "8px 12px",
            borderRadius: "var(--border-radius-lg)",
            minHeight: 38,
            maxHeight: 120,
            overflow: "auto",
            fontFamily: "var(--font-sans)"
          }}
          autoFocus
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim()}
          style={{
            padding: "8px 16px",
            cursor: input.trim() ? "pointer" : "default",
            opacity: input.trim() ? 1 : 0.4,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexShrink: 0,
            height: 38,
            borderRadius: "var(--border-radius-lg)"
          }}
          aria-label="Send message"
        >
          <i className="ti ti-send" style={{ fontSize: 15 }} aria-hidden="true" />
          Send
        </button>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
