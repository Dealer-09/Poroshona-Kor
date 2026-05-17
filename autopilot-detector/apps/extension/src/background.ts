import { io, Socket } from "socket.io-client";
import { BehavioralSignal } from "@autopilot/shared";

console.log("Autopilot Detector Background Service Worker running.");

// --- TAB TRACKING STATE ---
let tabSwitchCount = 0;
let rapidSwitchWindowCount = 0;
let rapidSwitchResetTimeout: ReturnType<typeof setTimeout> | null = null;
const RAPID_SWITCH_WINDOW_MS = 60000; // 60 seconds

// Reset total tabSwitchCount every 30 minutes
setInterval(() => {
  tabSwitchCount = 0;
}, 30 * 60 * 1000);

const handleTabSwitch = () => {
  tabSwitchCount++;
  rapidSwitchWindowCount++;

  // Rapid switching detection (>5 switches in 60s)
  if (rapidSwitchWindowCount > 5) {
    console.warn("Rapid tab switching detected!");
    // In future phases, we could dispatch an immediate signal here
  }

  // Reset rapid switch window after 60s of the FIRST switch in the window
  if (!rapidSwitchResetTimeout) {
    rapidSwitchResetTimeout = setTimeout(() => {
      rapidSwitchWindowCount = 0;
      rapidSwitchResetTimeout = null;
    }, RAPID_SWITCH_WINDOW_MS);
  }
};

chrome.tabs.onActivated.addListener(handleTabSwitch);
// Also count when a tab finishes updating (e.g. navigating to a new URL counts as a switch contextually)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    handleTabSwitch();
  }
});

// --- WEBSOCKET CONNECTION ---
let socket: Socket | null = null;
let currentSessionId: string | null = null;

const connectWebSocket = async () => {
  let result = await chrome.storage.local.get(["accessToken"]);
  let token = result.accessToken;

  if (!token) {
    try {
      console.log("No token found. Fetching dev token from API...");
      // For dev, register/login a test user to get a valid JWT
      await fetch("http://localhost:3000/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "extension_dev@example.com", password: "password123" })
      }).catch(() => {}); // ignore if already registered

      const loginRes = await fetch("http://localhost:3000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "extension_dev@example.com", password: "password123" })
      });
      const data = await loginRes.json();
      token = data.access_token;
      
      if (token) {
        await chrome.storage.local.set({ accessToken: token });
        console.log("Dev token securely stored.");
      }
    } catch (e) {
      console.error("Failed to fetch dev token", e);
    }
  }

  // Implement exponential backoff + jitter for reconnection
  socket = io("ws://localhost:3000", {
    transports: ["websocket"], // crucial for MV3 Service Workers
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.2, // This handles the requested ±20% random jitter internally!
  });

  socket.on("connect", () => {
    console.log("WebSocket connected to API.", socket?.id);
    // Note: We no longer auto-start the session here.
    // The Popup UI will emit START_SESSION when the user selects an intent.
  });

  socket.on("session:created", (data: { sessionId: string }) => {
    console.log("Session created:", data.sessionId);
    currentSessionId = data.sessionId;
  });

  socket.on("score:update", (scoreData) => {
    console.log("Received new Autopilot Score:", scoreData);
    // Broadcast score to the popup UI
    chrome.runtime.sendMessage({ type: "SCORE_UPDATE", payload: scoreData }).catch(() => {});
  });

  socket.on("disconnect", (reason) => {
    console.log("WebSocket disconnected:", reason);
  });
};

connectWebSocket();

// --- MESSAGE RELAY ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle Signals from Content Script
  if (message.type === "SIGNAL_BATCH" && currentSessionId && socket?.connected) {
    const rawSignals: Partial<BehavioralSignal>[] = message.payload;

    const completeSignals: BehavioralSignal[] = rawSignals.map((sig) => ({
      ...sig,
      sessionId: currentSessionId!,
      userId: "dev_user_1",
      tabSwitchCount: tabSwitchCount,
    } as BehavioralSignal));

    socket.emit("signal:batch", completeSignals);
  }
  
  // Handle Session Start from Popup
  if (message.type === "START_SESSION" && socket?.connected) {
    socket.emit("session:start", { 
      userId: "dev_user_1",
      appOpened: "Chrome Browser",
      declaredIntent: message.payload.intent
    });
  }

  // Handle Session End from Popup
  if (message.type === "END_SESSION" && currentSessionId && socket?.connected) {
    socket.emit("session:end", { sessionId: currentSessionId });
    currentSessionId = null; // Clear local session
  }

  sendResponse({ status: "ok" });
});

