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

// Stage 2: Midnight budget reset alarm
chrome.alarms.create("midnightBudgetReset", {
  when: getNextMidnight(),
  periodInMinutes: 24 * 60,
});

// Stage 2: Budget check every 30 seconds
chrome.alarms.create("budgetCheck", { periodInMinutes: 0.5 });

// Stage 2: Pomodoro State (must be declared before alarm listener)
let isPomodoroActive = false;
let isPomodoroBreak = false;
const POMODORO_FOCUS_MINS = 25;
const POMODORO_BREAK_MINS = 5;

function getNextMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "resetTabCount") {
    tabSwitchCount = 0;
  }

  // Stage 2: Reset daily usage at midnight
  if (alarm.name === "midnightBudgetReset") {
    await chrome.storage.local.set({ dailyUsage: {}, budgetOverrides: {} });
    console.log("✅ Daily budget usage reset at midnight");
  }

  // Stage 2: Budget enforcement every 30 seconds
  if (alarm.name === "budgetCheck") {
    await checkAndEnforceBudgets();
  }

  // Stage 2: Pomodoro phase switch
  if (alarm.name === "pomodoroPhase") {
    if (!isPomodoroActive) return;
    if (!isPomodoroBreak) {
      // Switch to break
      isPomodoroBreak = true;
      chrome.storage.session.set({ isPomodoroBreak: true });
      chrome.alarms.create("pomodoroPhase", { delayInMinutes: POMODORO_BREAK_MINS });
      chrome.notifications.create("pomo-break", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("src/icon.png"),
        title: "✅ Focus Complete!",
        message: `Take a ${POMODORO_BREAK_MINS} min break. You earned it.`,
        priority: 2,
      });
      chrome.action.setBadgeText({ text: "☕" });
    } else {
      // Switch back to focus
      isPomodoroBreak = false;
      chrome.storage.session.set({ isPomodoroBreak: false });
      chrome.alarms.create("pomodoroPhase", { delayInMinutes: POMODORO_FOCUS_MINS });
      chrome.notifications.create("pomo-focus", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("src/icon.png"),
        title: "🍅 Break Over",
        message: `Back to ${POMODORO_FOCUS_MINS} min focus. Let's go!`,
        priority: 2,
      });
      chrome.action.setBadgeText({ text: "🍅" });
    }
  }
});

// Stage 2: Budget enforcement logic
async function checkAndEnforceBudgets() {
  const result = await chrome.storage.local.get(["siteBudgets", "dailyUsage", "budgetOverrides"]);
  const budgets: Record<string, number> = result.siteBudgets || {};
  const overrides: Record<string, number> = result.budgetOverrides || {};

  if (Object.keys(budgets).length === 0) return;

  // Get active tab domain
  const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
  const activeTab = tabs[0];
  if (!activeTab?.url || !activeTab.id) return;

  let activeDomain = "";
  try { activeDomain = new URL(activeTab.url).hostname.replace(/^www\./, ""); } catch { return; }

  if (!budgets[activeDomain]) return;

  // Accumulate time (30s per alarm tick)
  const usage: Record<string, number> = result.dailyUsage || {};
  usage[activeDomain] = (usage[activeDomain] || 0) + 30;
  await chrome.storage.local.set({ dailyUsage: usage });

  const usedSeconds = usage[activeDomain];
  const budgetSeconds = budgets[activeDomain];

  // Check override
  const overrideExpiry = overrides[activeDomain] || 0;
  if (Date.now() < overrideExpiry) return; // In override window

  // Enforce budget
  if (usedSeconds >= budgetSeconds) {
    console.warn(`⛔ Budget exhausted for ${activeDomain}: ${usedSeconds}s used of ${budgetSeconds}s`);
    chrome.tabs.sendMessage(activeTab.id, {
      type: "SHOW_BUDGET_OVERLAY",
      payload: { domain: activeDomain, usedSeconds, budgetSeconds },
    }).catch(() => {});
  }
}


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


function startPomodoro() {
  isPomodoroActive = true;
  isPomodoroBreak = false;
  chrome.storage.session.set({ isPomodoroBreak: false, pomodoroActive: true });
  chrome.alarms.create("pomodoroPhase", { delayInMinutes: POMODORO_FOCUS_MINS });
  chrome.action.setBadgeText({ text: "🍅" });
  chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  chrome.notifications.create("pomo-start", {
    type: "basic",
    iconUrl: chrome.runtime.getURL("src/icon.png"),
    title: "🍅 Pomodoro Started",
    message: `${POMODORO_FOCUS_MINS} min focus session. Autopilot detection active.`,
    priority: 1,
  });
  console.log("🍅 Pomodoro focus started");
}

function stopPomodoro() {
  isPomodoroActive = false;
  isPomodoroBreak = false;
  chrome.storage.session.set({ isPomodoroBreak: false, pomodoroActive: false });
  chrome.alarms.clear("pomodoroPhase");
  chrome.action.setBadgeText({ text: "" });
  console.log("🍅 Pomodoro stopped");
}



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
        iconUrl: chrome.runtime.getURL("src/icon.png"),
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
        iconUrl: chrome.runtime.getURL("src/icon.png"),
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
        isPomodoroBreak: isPomodoroBreak, // Stage 2: pass break state to API
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
  if (message.type === "END_SESSION" && currentSessionId) {
    const endingSessionId = currentSessionId;
    currentSessionId = null; // Clear local session immediately

    // Persist the session ID so the MOOD_RATING handler can look it up asynchronously
    chrome.storage.local.set({ lastEndedSessionId: endingSessionId });

    // Only emit session:end if socket is connected (best-effort)
    if (socket?.connected) {
      socket.emit("session:end", { sessionId: endingSessionId });
    }

    // Stage 2: Show mood check overlay after session ends (always fires)
    chrome.tabs.query({ active: true, windowType: "normal" }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id && tab.url && !tab.url.includes("localhost") && !tab.url.includes("vercel")) {
        chrome.tabs.sendMessage(tab.id, { type: "SHOW_MOOD_CHECK", payload: { sessionId: endingSessionId } })
          .catch(() => {}); // Tab may not have content script
      }
    });
  }

  // Stage 2: Handle Mood Rating from content script mood overlay
  if (message.type === "MOOD_RATING") {
    const { rating } = message.payload;
    if (rating !== null && rating !== undefined) {
      // We need the most recently ended session id — read it from local storage as backup
      chrome.storage.local.get(["accessToken", "lastEndedSessionId"], async (result) => {
        const token = result.accessToken;
        const sessionId = result.lastEndedSessionId;
        if (token && sessionId) {
          try {
            await fetch(`${import.meta.env.VITE_API_URL}/sessions/${sessionId}/mood`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
              },
              body: JSON.stringify({ moodRating: rating }),
            });
            console.log(`✅ Mood rating ${rating} saved for session ${sessionId}`);
          } catch (err) {
            console.error("Failed to save mood rating:", err);
          }
        }
      });
    }
  }

  // Stage 2: Budget override — skip enforcement for this domain for 60 minutes
  if (message.type === "BUDGET_OVERRIDE") {
    const { domain } = message.payload;
    chrome.storage.local.get(["budgetOverrides"], (result) => {
      const overrides: Record<string, number> = result.budgetOverrides || {};
      overrides[domain] = Date.now() + 60 * 60 * 1000; // 60 minutes
      chrome.storage.local.set({ budgetOverrides: overrides });
      console.log(`⚠️ Budget override set for ${domain} for 60 minutes`);
    });
  }

  // Stage 2: Pomodoro control messages
  if (message.type === "START_POMODORO") {
    startPomodoro();
    sendResponse({ status: "pomodoro_started" });
    return true;
  }

  if (message.type === "STOP_POMODORO") {
    stopPomodoro();
    sendResponse({ status: "pomodoro_stopped" });
    return true;
  }

  sendResponse({ status: "ok" });
});

