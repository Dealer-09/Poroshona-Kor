// DOM Elements
const viewIntent = document.getElementById("view-intent")!;
const viewDashboard = document.getElementById("view-dashboard")!;
const intentButtons = document.querySelectorAll(".intent-btn");
const currentIntentDisplay = document.getElementById("current-intent")!;
const scoreValue = document.getElementById("score-value")!;
const scoreRing = document.getElementById("score-ring")!;
const statusText = document.getElementById("status-text")!;
const resetBtn = document.getElementById("reset-intent-btn")!;

// State
let currentScore = 0;

// Initialize
const init = async () => {
  const result = await chrome.storage.session.get(["userIntent"]);
  if (result.userIntent) {
    showDashboard(result.userIntent);
  } else {
    showIntentSelection();
  }
};

// UI Transitions
const showIntentSelection = () => {
  viewDashboard.classList.remove("active");
  viewIntent.classList.add("active");
};

const showDashboard = (intent: string) => {
  currentIntentDisplay.innerText = intent;
  viewIntent.classList.remove("active");
  viewDashboard.classList.add("active");
};

// Handle Intent Click
intentButtons.forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const target = e.currentTarget as HTMLButtonElement;
    const intent = target.getAttribute("data-intent");
    
    if (intent) {
      // 1. Save to session storage
      await chrome.storage.session.set({ userIntent: intent });
      
      // 2. Notify background script to start session
      chrome.runtime.sendMessage({
        type: "START_SESSION",
        payload: { intent }
      });
      
      // 3. Switch UI
      showDashboard(intent);
    }
  });
});

// Handle Reset
resetBtn.addEventListener("click", async () => {
  await chrome.storage.session.remove(["userIntent"]);
  
  // Notify backend to end session
  chrome.runtime.sendMessage({ type: "END_SESSION" });
  
  // Reset UI
  scoreValue.innerText = "--";
  statusText.innerText = "Calculating baseline...";
  scoreRing.className = "score-circle";
  statusText.className = "status-text";
  
  showIntentSelection();
});

// Listen for live updates from Background Worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SCORE_UPDATE") {
    const scoreData = message.payload;
    updateScoreUI(Math.round(scoreData.score));
  }
});

// Update Dashboard visuals based on score
const updateScoreUI = (score: number) => {
  scoreValue.innerText = score.toString();
  
  // Reset classes
  scoreRing.className = "score-circle";
  statusText.className = "status-text";
  
  if (score < 40) {
    scoreRing.classList.add("score-good");
    statusText.classList.add("text-good");
    statusText.innerText = "Highly Focused";
  } else if (score < 75) {
    scoreRing.classList.add("score-warn");
    statusText.classList.add("text-warn");
    statusText.innerText = "Drifting slightly";
  } else {
    scoreRing.classList.add("score-danger");
    statusText.classList.add("text-danger");
    statusText.innerText = "Autopilot Detected!";
  }
};

// Run
init();
