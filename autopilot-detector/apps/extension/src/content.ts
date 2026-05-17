import { BehavioralSignal } from "@autopilot/shared";

console.log("Autopilot Detector Content Script Loaded");

// --- STATE ---
let lastInteractionTime = Date.now();
let clickCount = 0;
let lastScrollY = window.scrollY;
let totalScrollDistance = 0;

let passiveTimeAcc = 0;
let activeTimeAcc = 0;

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

// --- SCROLL VELOCITY ---
const handleScroll = () => {
  handleInteraction();
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      const currentScrollY = window.scrollY;
      const distance = Math.abs(currentScrollY - lastScrollY);
      totalScrollDistance += distance;
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
  };

  signalBatch.push(signal);

  // Reset window metrics
  totalScrollDistance = 0;
  clickCount = 0;
  passiveTimeAcc = 0;
  activeTimeAcc = 0;

  // Batching: emit every 10 signals (~20 seconds)
  if (signalBatch.length >= 10) {
    chrome.runtime.sendMessage({
      type: "SIGNAL_BATCH",
      payload: signalBatch,
    });
    signalBatch = [];
  }
}, TICK_RATE_MS);

// --- CLEANUP ---
window.addEventListener("beforeunload", () => {
  window.removeEventListener("scroll", handleScroll);
  window.removeEventListener("touchmove", handleInteraction);
  window.removeEventListener("click", handleClick);
  window.removeEventListener("keydown", handleInteraction);
  
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (intervalId !== null) clearInterval(intervalId);
});
