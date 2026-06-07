import { BehavioralSignal } from "@autopilot/shared";

console.log("Autopilot Detector Content Script Loaded");

// --- STATE ---
let lastInteractionTime = Date.now();
let clickCount = 0;
let lastScrollY = window.scrollY;
let totalScrollDistance = 0;

let passiveTimeAcc = 0;
let activeTimeAcc = 0;

// Stage 2: Scroll depth + page reset tracking
let maxScrollDepth = 0;   // max % scrolled down during this interval
let pageResetCount = 0;   // times the user jumped back to top (infinite scroll loop)

// Batch buffer
let signalBatch: Partial<BehavioralSignal>[] = [];

// Timers
let rafId: number | null = null;
let intervalId: number | null = null;

// --- IDLE / ACTIVE DETECTION ---
const handleInteraction = () => {
  lastInteractionTime = Date.now();
};

const handleClick = () => {
  handleInteraction();
  clickCount++;
};

// --- SCROLL VELOCITY + DEPTH + PAGE RESET ---
const handleScroll = () => {
  handleInteraction();
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      const currentScrollY = window.scrollY;
      const distance = Math.abs(currentScrollY - lastScrollY);
      totalScrollDistance += distance;

      // Stage 2: Track scroll depth (0–100%)
      const pageHeight = Math.max(1, document.body.scrollHeight - window.innerHeight);
      const depthPercent = Math.round((currentScrollY / pageHeight) * 100);
      if (depthPercent > maxScrollDepth) {
        maxScrollDepth = depthPercent;
      }

      // Stage 2: Detect page reset (jumped from deep scroll back to top)
      // Classic infinite scroll loop signal: hit bottom → page reloads to top
      if (currentScrollY < 50 && lastScrollY > 500) {
        pageResetCount++;
      }

      lastScrollY = currentScrollY;
      rafId = null;
    });
  }
};

// --- EVENT LISTENERS ---
window.addEventListener("scroll", handleScroll, { passive: true });
window.addEventListener("touchmove", handleInteraction, { passive: true });
window.addEventListener("click", handleClick, { passive: true });
window.addEventListener("keydown", handleInteraction, { passive: true });

// --- AGGREGATOR LOOP ---
// Runs every 2 seconds to aggregate the slice of time
const TICK_RATE_MS = 2000;

intervalId = window.setInterval(() => {
  const now = Date.now();
  const timeSinceLastInteraction = now - lastInteractionTime;

  // If no interaction in the last 2 seconds, this 2s chunk is entirely passive.
  // Otherwise, we consider it active. 
  // For precise sub-second tracking we can be more granular, but for MV3 this is efficient.
  if (timeSinceLastInteraction > TICK_RATE_MS) {
    passiveTimeAcc += TICK_RATE_MS;
  } else {
    activeTimeAcc += TICK_RATE_MS;
  }

  // Calculate pixels per second for the last 2s tick
  const scrollVelocity = totalScrollDistance / (TICK_RATE_MS / 1000);

  // Build the signal.
  // Note: sessionId and userId are managed by the background script,
  // so we send a partial signal and let the background worker merge it.
  const signal: Partial<BehavioralSignal> = {
    timestamp: new Date().toISOString(),
    scrollVelocity: Math.round(scrollVelocity),
    tabSwitchCount: 0, // Tracked by background script
    clickRate: clickCount,
    passiveTime: passiveTimeAcc / 1000, // in seconds
    activeTime: activeTimeAcc / 1000, // in seconds
    // Stage 2: infinite scroll signals
    scrollDepthPercent: maxScrollDepth,
    pageResetCount: pageResetCount,
  };

  signalBatch.push(signal);

  // Reset window metrics
  totalScrollDistance = 0;
  clickCount = 0;
  passiveTimeAcc = 0;
  activeTimeAcc = 0;
  // Stage 2: reset scroll depth + page reset counters each interval
  maxScrollDepth = 0;
  pageResetCount = 0;

  // Batching: emit every 2 signals (~4 seconds) for baseline aggregation
  if (signalBatch.length >= 2) {
    try {
      chrome.runtime.sendMessage({
        type: "SIGNAL_BATCH",
        payload: signalBatch,
      }).catch(() => console.debug("Background worker sleeping or busy"));
    } catch (e) {
      console.debug("Extension context invalidated. Please refresh the page.");
    }
    signalBatch = [];
  }

  // SPA URL Change / Initial Metadata Extraction
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    sendMetadata();
  }
}, TICK_RATE_MS);

function extractMetadata() {
  const title = document.title;
  let category = undefined;

  if (window.location.hostname.includes("youtube.com")) {
    const genreMeta = document.querySelector('meta[itemprop="genre"]');
    if (genreMeta) {
      category = genreMeta.getAttribute("content") || undefined;
    }
  } else if (window.location.hostname.includes("instagram.com")) {
    category = "Social";
  }

  return { title, category };
}

function sendMetadata() {
  try {
    const metadata = extractMetadata();
    chrome.runtime.sendMessage({
      type: "SESSION_METADATA",
      payload: metadata,
    }).catch(() => {});
  } catch (e) {
    console.debug("Context invalidated while sending metadata");
  }
}

// Initial trigger
let lastUrl = window.location.href;
setTimeout(sendMetadata, 1000); // Small delay to let document load fully

// --- AUTHENTICATION BRIDGE ---
window.addEventListener("message", (event) => {
  // Only accept messages from the dashboard
  if (
    event.origin === "http://localhost:3000" || 
    event.origin.includes("vercel.app") ||
    event.origin.includes("onrender.com")
  ) {
    if (event.data?.type === "AUTOPILOT_AUTH_TOKEN" && event.data?.token) {
      try {
        chrome.runtime.sendMessage({
          type: "SAVE_AUTH_TOKEN",
          payload: event.data.token,
        }).catch(() => console.debug("Auth bridge: Background worker busy"));
      } catch (e) {
        console.debug("Auth bridge: Extension context invalidated");
      }
    }
  }
});

// --- INTERVENTION OVERLAYS + MOOD CHECK ---
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("📥 Content Script received message from background:", message);
  if (message.type === "TRIGGER_PAUSE_OVERLAY") {
    createInterventionOverlay(message.payload.message, "PAUSE", message.payload.sessionId, message.payload.intent);
  } else if (message.type === "TRIGGER_REFLECTION_OVERLAY") {
    createInterventionOverlay(message.payload.message, "REFLECTION", message.payload.sessionId, message.payload.intent);
  } else if (message.type === "TRIGGER_PREEMPTIVE_NUDGE") {
    // Stage 3: forward-looking warning — a lighter "PAUSE"-style banner shown
    // BEFORE onset, driven by the prediction model rather than the current score.
    createInterventionOverlay(message.payload.message, "PAUSE", message.payload.sessionId, message.payload.intent);
  } else if (message.type === "SHOW_MOOD_CHECK") {
    // Stage 2: Post-session mood check overlay
    createMoodOverlay();
  } else if (message.type === "SHOW_BUDGET_OVERLAY") {
    // Stage 2: Budget exhausted overlay
    createBudgetOverlay(message.payload.domain, message.payload.usedSeconds, message.payload.budgetSeconds);
  }
  sendResponse({ status: "overlay_received" });
});

// --- STAGE 2: MOOD CHECK OVERLAY ---
function createMoodOverlay() {
  if (document.getElementById("autopilot-mood-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "autopilot-mood-overlay";
  overlay.className = "mood-overlay";

  const card = document.createElement("div");
  card.className = "mood-overlay-card";

  const heading = document.createElement("div");
  heading.className = "autopilot-title";
  heading.style.fontSize = "20px";
  heading.style.marginBottom = "8px";
  heading.textContent = "HOW DID THAT SESSION FEEL?";
  card.appendChild(heading);

  const sub = document.createElement("div");
  sub.className = "autopilot-message";
  sub.style.marginBottom = "20px";
  sub.textContent = "Rate your mental state after this browsing session.";
  card.appendChild(sub);

  const moods = [
    { rating: 1, emoji: "😩", label: "Drained" },
    { rating: 2, emoji: "😕", label: "Meh" },
    { rating: 3, emoji: "😐", label: "Neutral" },
    { rating: 4, emoji: "🙂", label: "Good" },
    { rating: 5, emoji: "😄", label: "Energized" },
  ];

  const emojiRow = document.createElement("div");
  emojiRow.style.display = "flex";
  emojiRow.style.gap = "12px";
  emojiRow.style.justifyContent = "center";
  emojiRow.style.marginBottom = "16px";

  const dismiss = () => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 400);
  };

  moods.forEach(({ rating, emoji, label }) => {
    const btn = document.createElement("button");
    btn.className = "mood-emoji-btn";
    btn.innerHTML = `<span style="font-size:28px;display:block">${emoji}</span><span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">${label}</span>`;
    btn.onclick = () => {
      try {
        chrome.runtime.sendMessage({ type: "MOOD_RATING", payload: { rating } }).catch(() => {});
      } catch (e) {}
      dismiss();
    };
    emojiRow.appendChild(btn);
  });
  card.appendChild(emojiRow);

  const skipLink = document.createElement("div");
  skipLink.style.cssText = "text-align:center;font-size:12px;color:#64748b;cursor:pointer;text-decoration:underline;margin-top:4px";
  skipLink.textContent = "Skip";
  skipLink.onclick = () => {
    try {
      chrome.runtime.sendMessage({ type: "MOOD_RATING", payload: { rating: null } }).catch(() => {});
    } catch (e) {}
    dismiss();
  };
  card.appendChild(skipLink);

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Animate in
  setTimeout(() => { overlay.style.opacity = "1"; card.style.transform = "translateY(0)"; }, 50);

  // Auto-dismiss after 20 seconds
  setTimeout(() => {
    try {
      chrome.runtime.sendMessage({ type: "MOOD_RATING", payload: { rating: null } }).catch(() => {});
    } catch (e) {}
    dismiss();
  }, 20000);
}

// --- STAGE 2: BUDGET EXHAUSTED OVERLAY ---
function createBudgetOverlay(domain: string, usedSeconds: number, budgetSeconds: number) {
  if (document.getElementById("autopilot-budget-overlay")) return;

  const usedMins = Math.round(usedSeconds / 60);
  const budgetMins = Math.round(budgetSeconds / 60);

  const overlay = document.createElement("div");
  overlay.id = "autopilot-budget-overlay";
  overlay.className = "autopilot-intervention-overlay";
  overlay.style.background = "rgba(0,0,0,0.9)";

  const container = document.createElement("div");
  container.className = "autopilot-container";
  container.style.borderTop = "4px solid #ef4444";

  const heading = document.createElement("div");
  heading.className = "autopilot-title";
  heading.style.color = "#ef4444";
  heading.textContent = "BUDGET EXHAUSTED";
  container.appendChild(heading);

  const domainEl = document.createElement("div");
  domainEl.style.cssText = "font-size:14px;font-weight:700;color:#94a3b8;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.1em";
  domainEl.textContent = domain;
  container.appendChild(domainEl);

  const body = document.createElement("div");
  body.className = "autopilot-message";
  body.textContent = `You set a ${budgetMins} min daily limit. You have used ${usedMins} min today.`;
  container.appendChild(body);

  const footer = document.createElement("div");
  footer.style.cssText = "font-size:11px;color:#475569;text-align:center;margin-bottom:16px;font-style:italic";
  footer.textContent = "Budget resets at midnight.";
  container.appendChild(footer);

  const btnGroup = document.createElement("div");
  btnGroup.className = "autopilot-button-group";

  const leaveBtn = document.createElement("button");
  leaveBtn.className = "autopilot-btn autopilot-btn-primary";
  leaveBtn.style.background = "#ef4444";
  leaveBtn.textContent = "LEAVE SITE";
  leaveBtn.onclick = () => { window.history.back(); };
  btnGroup.appendChild(leaveBtn);

  const overrideBtn = document.createElement("button");
  overrideBtn.className = "autopilot-btn autopilot-btn-secondary";
  overrideBtn.textContent = "OVERRIDE — I'M SURE";
  overrideBtn.onclick = () => {
    try {
      chrome.runtime.sendMessage({ type: "BUDGET_OVERRIDE", payload: { domain } }).catch(() => {});
    } catch (e) {}
    overlay.remove();
  };
  btnGroup.appendChild(overrideBtn);

  container.appendChild(btnGroup);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  setTimeout(() => { overlay.style.opacity = "1"; container.style.transform = "translateY(0)"; }, 50);
}


function createInterventionOverlay(messageText: string, type: "PAUSE" | "REFLECTION", sessionId: string, intent?: string) {
  // Check if an overlay already exists
  if (document.getElementById("autopilot-intervention-overlay")) {
    return;
  }

  // Create overlay container
  const overlay = document.createElement("div");
  overlay.id = "autopilot-intervention-overlay";

  const container = document.createElement("div");
  container.className = "autopilot-container";

  // Pulse icon
  const iconPulse = document.createElement("div");
  iconPulse.className = "autopilot-icon-pulse";
  const innerIcon = document.createElement("span");
  innerIcon.textContent = type === "PAUSE" ? "⏸️" : "💡";
  innerIcon.style.fontSize = "26px";
  iconPulse.appendChild(innerIcon);
  container.appendChild(iconPulse);

  // Title
  const title = document.createElement("div");
  title.className = "autopilot-title";
  title.textContent = "Are you sure you want to proceed?";
  container.appendChild(title);

  // Message
  const message = document.createElement("div");
  message.className = "autopilot-message";
  if (intent) {
    message.innerHTML = `You declared your intent as <strong style="color: #3b82f6; text-transform: uppercase;">${intent}</strong>, but you are currently watching this video instead.<br/><br/><span style="font-size: 14px; color: #94a3b8; font-style: italic;">"${messageText}"</span>`;
  } else {
    message.textContent = messageText;
  }
  container.appendChild(message);

  // Add textarea for Reflection
  let textarea: HTMLTextAreaElement | null = null;
  if (type === "REFLECTION") {
    textarea = document.createElement("textarea");
    textarea.className = "autopilot-textarea";
    textarea.placeholder = "Write down a mindful thought to unlock this page...";
    container.appendChild(textarea);
  }

  // Button Group
  const buttonGroup = document.createElement("div");
  buttonGroup.className = "autopilot-button-group";

  const closeTabBtn = document.createElement("button");
  closeTabBtn.className = "autopilot-btn autopilot-btn-secondary";
  closeTabBtn.textContent = "Close Tab";
  closeTabBtn.onclick = () => {
    try {
      chrome.runtime.sendMessage({ type: "END_SESSION", payload: { sessionId } }).catch(() => {});
    } catch (e) {}
    // Trigger close in a gentle way (standard window.close fallback message)
    window.close();
    // Fallback if browser blocks automatic closure
    alert("Mindful closing: Please close this tab manually to stay focused!");
  };
  buttonGroup.appendChild(closeTabBtn);

  const continueBtn = document.createElement("button");
  continueBtn.className = "autopilot-btn autopilot-btn-primary";
  continueBtn.textContent = type === "PAUSE" ? "Continue Intentionally" : "Unlock Page";
  
  if (type === "REFLECTION" && textarea) {
    continueBtn.disabled = true;
    textarea.oninput = () => {
      continueBtn.disabled = textarea!.value.trim().length < 8; // Require at least 8 chars
    };
  }

  continueBtn.onclick = () => {
    overlay.style.opacity = "0";
    container.style.transform = "translateY(20px)";
    setTimeout(() => {
      overlay.remove();
    }, 500);
  };
  buttonGroup.appendChild(continueBtn);

  container.appendChild(buttonGroup);
  overlay.appendChild(container);
  document.body.appendChild(overlay);

  // Force reflow and animate in
  setTimeout(() => {
    overlay.style.opacity = "1";
    container.style.transform = "translateY(0)";
  }, 50);
}

// --- CLEANUP ---
window.addEventListener("beforeunload", () => {
  window.removeEventListener("scroll", handleScroll);
  window.removeEventListener("touchmove", handleInteraction);
  window.removeEventListener("click", handleClick);
  window.removeEventListener("keydown", handleInteraction);
  
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (intervalId !== null) clearInterval(intervalId);
});
