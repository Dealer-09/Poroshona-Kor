import { BehavioralSignal } from "@autopilot/shared";

chrome.runtime.onInstalled.addListener(() => {
  console.log("Autopilot Detector Extension Installed.");
});

// A quick test to ensure the shared package is successfully linked
const testSignal: BehavioralSignal = {
  sessionId: "test",
  userId: "test",
  timestamp: new Date().toISOString(),
  scrollVelocity: 0,
  tabSwitchCount: 0,
  clickRate: 0,
  passiveTime: 0,
  activeTime: 0,
};

console.log("Background Service Worker running...", testSignal);
