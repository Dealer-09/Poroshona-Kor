/// <reference types="vite/client" />
import { io, Socket } from "socket.io-client";
import { BehavioralSignal } from "@autopilot/shared";

console.log("Autopilot Detector Background Service Worker running.");


// --- TAB TRACKING STATE ---
let tabSwitchCount = 0;
let rapidSwitchWindowCount = 0;
// ponytail: chrome.alarms instead of setTimeout — SW can be suspended mid-timeout in MV3
const RAPID_SWITCH_ALARM = "resetRapidSwitch";

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
  // Alarms survive SW termination but in-memory flags do not — rehydrate first
  // so e.g. the pomodoro phase switch below sees the real isPomodoroActive.
  await rehydrateState();

  if (alarm.name === "resetTabCount") {
    tabSwitchCount = 0;
  }

  if (alarm.name === RAPID_SWITCH_ALARM) {
    rapidSwitchWindowCount = 0;
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
  }

  // Reset the rapid-switch window via alarm (survives SW suspension unlike setTimeout)
  chrome.alarms.get(RAPID_SWITCH_ALARM, (existing) => {
    if (!existing) chrome.alarms.create(RAPID_SWITCH_ALARM, { delayInMinutes: 1 });
  });
};

chrome.tabs.onActivated.addListener(handleTabSwitch);
// NOTE: we deliberately do NOT count tabs.onUpdated "complete" as a tab switch.
// A page finishing loading (SPA navigations, iframes, ordinary reloads) is not a
// context switch, and counting it inflated tabSwitchCount and thus the focus-
// fragmentation sub-score. Genuine tab switches are captured by onActivated.

// --- WEBSOCKET CONNECTION ---
let socket: Socket | null = null;
let currentSessionId: string | null = null;
let currentIntent: string | null = null;

// MV3 service workers are ephemeral — Chrome terminates the SW after ~30s idle,
// wiping every module-level variable above. We therefore mirror the session/
// pomodoro state into chrome.storage.session (cleared when the browser closes,
// persists across SW restarts within a browser run) and rehydrate on wake.
const SESSION_STATE_KEY = "sessionState";

async function persistSessionState() {
  await chrome.storage.session.set({
    [SESSION_STATE_KEY]: {
      currentSessionId,
      currentIntent,
      isPomodoroActive,
      isPomodoroBreak,
    },
  });
}

let rehydrated = false;
async function rehydrateState(): Promise<void> {
  if (rehydrated) return;
  rehydrated = true;
  try {
    const stored = await chrome.storage.session.get([SESSION_STATE_KEY]);
    const s = stored[SESSION_STATE_KEY] as
      | {
          currentSessionId: string | null;
          currentIntent: string | null;
          isPomodoroActive: boolean;
          isPomodoroBreak: boolean;
        }
      | undefined;
    if (s) {
      currentSessionId = s.currentSessionId ?? null;
      currentIntent = s.currentIntent ?? null;
      isPomodoroActive = s.isPomodoroActive ?? false;
      isPomodoroBreak = s.isPomodoroBreak ?? false;
      console.log("♻️ Rehydrated session state:", s);
    }
  } catch (e) {
    console.error("Failed to rehydrate session state", e);
  }
}

/** Ensure the socket exists and is connecting/connected. Safe to call repeatedly. */
async function ensureSocketConnected(): Promise<void> {
  if (socket && (socket.connected || socket.active)) return;
  await connectWebSocket();
}

function isJwtExpired(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;

    // JWT payloads are base64URL, which atob() does not decode — normalize
    // to standard base64 first so tokens containing - or _ don't falsely
    // read as expired (which would silently drop the connection).
    const payloadPart = (parts[1] ?? "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    if (!payloadPart) return true;

    const payload = JSON.parse(atob(payloadPart));
    if (typeof payload.exp !== "number") return true;

    return payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}


function startPomodoro() {
  isPomodoroActive = true;
  isPomodoroBreak = false;
  chrome.storage.session.set({ isPomodoroBreak: false, pomodoroActive: true });
  void persistSessionState();
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
  void persistSessionState();
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

  if (isJwtExpired(token)) {
    console.warn("Stored auth token expired. Clearing extension auth state.");
    await chrome.storage.local.remove(["accessToken"]);
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
    void persistSessionState();
  });

  socket.on("score:update", (scoreData) => {
    console.log("Received new Autopilot Score:", scoreData);
    chrome.storage.session.set({ lastScore: Math.round(scoreData.score) });
    // Broadcast score to the popup UI
    chrome.runtime.sendMessage({ type: "SCORE_UPDATE", payload: scoreData }).catch(() => {});
  });

  // Stage 3: forward-looking onset risk. Surface a gentle pre-emptive banner when
  // the model predicts doomscroll onset is likely in the next few minutes — the
  // "catch you before it locks in" signal, distinct from reactive interventions.
  socket.on(
    "prediction:risk",
    (prediction: {
      sessionId: string;
      probability: number;
      horizonMinutes: number;
      source: string;
    }) => {
      chrome.storage.session.set({ lastPrediction: prediction }).catch(() => {});
      chrome.runtime
        .sendMessage({ type: "PREDICTION_UPDATE", payload: prediction })
        .catch(() => {});

      if (prediction.probability >= 0.7 && !isPomodoroBreak) {
        chrome.tabs.query({ active: true, windowType: "normal" }, (tabs) => {
          const tab = tabs[0];
          if (
            tab?.id &&
            (!tab.url ||
              (!tab.url.includes("localhost") && !tab.url.includes("vercel")))
          ) {
            chrome.tabs
              .sendMessage(tab.id, {
                type: "TRIGGER_PREEMPTIVE_NUDGE",
                payload: {
                  message: `Heads up — you're drifting toward autopilot. ${Math.round(
                    prediction.probability * 100,
                  )}% risk in the next ${prediction.horizonMinutes} min.`,
                  sessionId: currentSessionId,
                  intent: currentIntent,
                },
              })
              .catch(() => {});
          }
        });
      }
    },
  );

  socket.on("intervention:trigger", async (intervention) => {
    console.log("Received AI Intervention:", intervention);

    // Save to local storage
    const result = await chrome.storage.local.get(["interventions"]);
    const list: object[] = result.interventions || [];
    list.push({ ...intervention, timestamp: new Date().toISOString() });
    // ponytail: cap at 50 so we never hit Chrome's 5MB local storage quota
    await chrome.storage.local.set({ interventions: list.slice(-50) });

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

// Bootstrap on SW load AND on browser startup. onStartup fires when Chrome
// launches; the top-level call covers SW restarts mid-run (which don't fire
// onStartup). Both rehydrate persisted state before reconnecting.
async function bootstrap() {
  await rehydrateState();
  await connectWebSocket();
}
chrome.runtime.onStartup.addListener(() => {
  void bootstrap();
});
void bootstrap();

// --- MESSAGE RELAY ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Handle Signals from Content Script. The SW may have just woken from
  // termination, so rehydrate session state and (re)connect the socket BEFORE
  // deciding whether to forward — otherwise mid-session signals are silently
  // dropped, leaving holes in the event sequence.
  if (message.type === "SIGNAL_BATCH") {
    void (async () => {
      await rehydrateState();
      await ensureSocketConnected();
      if (!currentSessionId || !socket?.connected) return; // no active session

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

        const completeSignals: BehavioralSignal[] = rawSignals.map(
          (sig) =>
            ({
              ...sig,
              sessionId: currentSessionId!,
              tabSwitchCount: tabSwitchCount,
              activeDomain: activeDomain,
              activeTabTitle: activeTabTitle,
              isPomodoroBreak: isPomodoroBreak, // Stage 2: pass break state to API
            }) as BehavioralSignal,
        );

        socket?.emit("signal:batch", completeSignals);
      });
    })();
    return;
  }

  // Handle Session Metadata from Content Script
  if (message.type === "SESSION_METADATA") {
    void (async () => {
      await rehydrateState();
      await ensureSocketConnected();
      if (!currentSessionId || !socket?.connected) return;
      socket.emit("session:metadata", {
        sessionId: currentSessionId,
        pageTitle: message.payload.title,
        pageCategory: message.payload.category,
      });
    })();
    return;
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
  if (message.type === "START_SESSION") {
    void (async () => {
      await rehydrateState();
      await ensureSocketConnected();
      currentIntent = message.payload.intent;
      await persistSessionState();

      // ponytail: ensureSocketConnected only *initiates* — wait for actual connect
      if (!socket) return;
      if (!socket.connected) {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("socket timeout")), 5000);
          socket!.once("connect", () => { clearTimeout(timeout); resolve(); });
          socket!.once("connect_error", (e) => { clearTimeout(timeout); reject(e); });
        }).catch((e) => { console.warn("START_SESSION: socket failed to connect:", e); return null; });
      }
      if (!socket?.connected) {
        console.warn("Cannot start session — socket not connected.");
        return;
      }
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        let appOpened = "Chrome Browser";
        try {
          appOpened = new URL(tabs[0]?.url || "").hostname || "Chrome Browser";
        } catch {}
        socket?.emit("session:start", {
          appOpened,
          declaredIntent: message.payload.intent,
        });
      });
    })();
    return;
  }


  // Handle Session End from Popup
  if (message.type === "END_SESSION") {
    void (async () => {
      await rehydrateState();
      if (!currentSessionId) return;
      const endingSessionId = currentSessionId;
      currentSessionId = null; // Clear local session immediately
      await persistSessionState();

      // Persist the session ID so the MOOD_RATING handler can look it up asynchronously
      chrome.storage.local.set({ lastEndedSessionId: endingSessionId });

      // Only emit session:end if socket is connected (best-effort)
      await ensureSocketConnected();
      if (socket?.connected) {
        socket.emit("session:end", { sessionId: endingSessionId });
      }

      // Stage 2: Show mood check overlay after session ends (always fires)
      chrome.tabs.query({ active: true, windowType: "normal" }, (tabs) => {
        const tab = tabs[0];
        if (
          tab?.id &&
          tab.url &&
          !tab.url.includes("localhost") &&
          !tab.url.includes("vercel")
        ) {
          chrome.tabs
            .sendMessage(tab.id, {
              type: "SHOW_MOOD_CHECK",
              payload: { sessionId: endingSessionId },
            })
            .catch(() => {}); // Tab may not have content script
        }
      });
    })();
    return;
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

