/// <reference types="vite/client" />
import { io, Socket } from "socket.io-client";
import { BehavioralSignal } from "@autopilot/shared";

console.log("Autopilot Detector Background Service Worker running.");


// --- TAB TRACKING STATE ---
let tabSwitchCount = 0;
let rapidSwitchWindowCount = 0;
let rapidSwitchResetTimeout: ReturnType<typeof setTimeout> | null = null;
const RAPID_SWITCH_WINDOW_MS = 60000; // 60 seconds

// Reset total tabSwitchCount every 30 minutes
chrome.alarms.create("resetTabCount", { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "resetTabCount") {
    tabSwitchCount = 0;
  }
});

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
let currentIntent: string | null = null;

const connectWebSocket = async () => {
  let result = await chrome.storage.local.get(["accessToken"]);
  let token = result.accessToken;

  if (!token) {
    console.warn("No auth token. Please log in via the dashboard.");
    return;
  }

  // Implement exponential backoff + jitter for reconnection
  socket = io(import.meta.env.VITE_WS_URL || "ws://localhost:3001", {
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
    chrome.storage.session.set({ lastScore: Math.round(scoreData.score) });
    // Broadcast score to the popup UI
    chrome.runtime.sendMessage({ type: "SCORE_UPDATE", payload: scoreData }).catch(() => {});
  });

  socket.on("intervention:trigger", async (intervention) => {
    console.log("Received AI Intervention:", intervention);

    // Save to local storage
    const result = await chrome.storage.local.get(["interventions"]);
    const list = result.interventions || [];
    list.push({ ...intervention, timestamp: new Date().toISOString() });
    await chrome.storage.local.set({ interventions: list });

    // Handle by type
    if (intervention.type === "NUDGE") {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "src/icon.png",
        title: "Autopilot Detector - Gentle Nudge",
        message: intervention.message,
        priority: 2,
      });
    } else if (intervention.type === "PAUSE") {
      chrome.tabs.query({ active: true, windowType: "normal" }, (tabs) => {
        console.log("🚨 [DIAGNOSTIC] Found " + tabs.length + " tabs for PAUSE");
        tabs.forEach((tab) => {
          if (tab.id && (!tab.url || (!tab.url.includes("localhost") && !tab.url.includes("vercel")))) {
            chrome.tabs.sendMessage(tab.id, {
              type: "TRIGGER_PAUSE_OVERLAY",
              payload: {
                message: intervention.message,
                sessionId: currentSessionId,
                intent: currentIntent
              }
            }).then(() => console.log("✅ PAUSE sent successfully to tab:", tab.id, tab.url))
              .catch((err) => console.log("❌ PAUSE failed for tab:", tab.id, tab.url, err.message));
          }
        });
      });
    } else if (intervention.type === "REFLECTION") {
      chrome.tabs.query({ active: true, windowType: "normal" }, (tabs) => {
        console.log("🚨 [DIAGNOSTIC] Found " + tabs.length + " tabs for REFLECTION");
        tabs.forEach((tab) => {
          if (tab.id && (!tab.url || (!tab.url.includes("localhost") && !tab.url.includes("vercel")))) {
            chrome.tabs.sendMessage(tab.id, {
              type: "TRIGGER_REFLECTION_OVERLAY",
              payload: {
                message: intervention.message,
                sessionId: currentSessionId,
                intent: currentIntent
              }
            }).then(() => console.log("✅ REFLECTION sent successfully to tab:", tab.id, tab.url))
              .catch((err) => console.log("❌ REFLECTION failed for tab:", tab.id, tab.url, err.message));
          }
        });
      });
    } else if (intervention.type === "SLEEP_MODE") {
      chrome.action.setBadgeText({ text: "💤" });
      chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
      chrome.notifications.create({
        type: "basic",
        iconUrl: "src/icon.png",
        title: "Late Night Sleep Mode",
        message: intervention.message,
        priority: 2,
      });
    }
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

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      let activeDomain = "unknown";
      let activeTabTitle = "";
      if (activeTab?.url) {
        try {
          const urlObj = new URL(activeTab.url);
          activeDomain = urlObj.hostname;
        } catch (e) {
          console.error("Failed to parse tab URL:", e);
        }
      }
      if (activeTab?.title) {
        activeTabTitle = activeTab.title;
      }

      const completeSignals: BehavioralSignal[] = rawSignals.map((sig) => ({
        ...sig,
        sessionId: currentSessionId!,
        tabSwitchCount: tabSwitchCount,
        activeDomain: activeDomain,
        activeTabTitle: activeTabTitle,
      } as BehavioralSignal));

      socket?.emit("signal:batch", completeSignals);
    });
  }

  // Handle Session Metadata from Content Script
  if (message.type === "SESSION_METADATA" && currentSessionId && socket?.connected) {
    socket.emit("session:metadata", {
      sessionId: currentSessionId,
      pageTitle: message.payload.title,
      pageCategory: message.payload.category,
    });
  }
  
  if (message.type === "SAVE_AUTH_TOKEN") {
    console.log("Saving Auth Token from Dashboard...");
    chrome.storage.local.set({ accessToken: message.payload }, () => {
      socket?.disconnect();
      // Reconnect WebSockets with the new token
      connectWebSocket();
    });
    return;
  }

  // Handle Session Start from Popup
  if (message.type === "START_SESSION" && socket?.connected) {
    currentIntent = message.payload.intent;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let appOpened = "Chrome Browser";
      try { appOpened = new URL(tabs[0]?.url || "").hostname || "Chrome Browser"; } catch {}
      socket?.emit("session:start", { 
        appOpened,
        declaredIntent: message.payload.intent
      });
    });
  }

  // Handle Session End from Popup
  if (message.type === "END_SESSION" && currentSessionId && socket?.connected) {
    socket.emit("session:end", { sessionId: currentSessionId });
    currentSessionId = null; // Clear local session
  }

  sendResponse({ status: "ok" });
});

