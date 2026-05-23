// DOM Elements — existing
const viewIntent = document.getElementById("view-intent")!;
const viewDashboard = document.getElementById("view-dashboard")!;
const intentButtons = document.querySelectorAll(".intent-btn");
const currentIntentDisplay = document.getElementById("current-intent")!;
const scoreValue = document.getElementById("score-value")!;
const scoreRing = document.getElementById("score-ring")!;
const statusText = document.getElementById("status-text")!;
const resetBtn = document.getElementById("reset-intent-btn")!;
const pomodoroBtn = document.getElementById("pomodoro-btn") as HTMLButtonElement | null;

// State
let currentScore = 0;
let isPomodoroRunning = false;

// Stage 2: Pomodoro button handler
if (pomodoroBtn) {
  // Initialize button from session state
  chrome.storage.session.get(["pomodoroActive"]).then((result) => {
    isPomodoroRunning = !!result.pomodoroActive;
    updatePomodoroBtn();
  });

  pomodoroBtn.addEventListener("click", () => {
    if (!isPomodoroRunning) {
      chrome.runtime.sendMessage({ type: "START_POMODORO" });
      isPomodoroRunning = true;
    } else {
      chrome.runtime.sendMessage({ type: "STOP_POMODORO" });
      isPomodoroRunning = false;
    }
    updatePomodoroBtn();
  });
}

function updatePomodoroBtn() {
  if (!pomodoroBtn) return;
  if (isPomodoroRunning) {
    pomodoroBtn.textContent = "⏹ STOP POMODORO";
    pomodoroBtn.style.background = "#64748b";
  } else {
    pomodoroBtn.textContent = "🍅 START FOCUS";
    pomodoroBtn.style.background = "#ef4444";
  }
}

// Stage 2: Budget DOM Elements
const viewBudgets = document.getElementById("view-budgets")!;
const budgetDomainInput = document.getElementById("budget-domain-input") as HTMLInputElement;
const budgetMinsInput = document.getElementById("budget-mins-input") as HTMLInputElement;
const budgetAddBtn = document.getElementById("budget-add-btn")!;
const budgetList = document.getElementById("budget-list")!;
const budgetClearAll = document.getElementById("budget-clear-all")!;

// Stage 2: Nav Tab Elements
const navTabs = document.querySelectorAll<HTMLButtonElement>(".nav-tab");



// ==========================================
// Stage 2: Nav Tab Switching
// ==========================================
navTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const targetId = tab.getAttribute("data-target");
    if (!targetId) return;

    // Update tab active state
    navTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");

    // Show the correct view
    [viewIntent, viewDashboard, viewBudgets].forEach((v) => v.classList.remove("active"));
    document.getElementById(targetId)!.classList.add("active");
  });
});

// ==========================================
// Stage 2: Budget Management
// ==========================================
type SiteBudgets = Record<string, number>; // domain -> seconds

async function getBudgets(): Promise<SiteBudgets> {
  const result = await chrome.storage.local.get(["siteBudgets"]);
  return (result.siteBudgets as SiteBudgets) || {};
}

function renderBudgetList(budgets: SiteBudgets) {
  budgetList.innerHTML = "";
  const entries = Object.entries(budgets);
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "budget-empty";
    empty.textContent = "No budgets set yet.";
    budgetList.appendChild(empty);
    return;
  }
  entries.forEach(([domain, seconds]) => {
    const mins = Math.round(seconds / 60);
    const item = document.createElement("div");
    item.className = "budget-item";
    item.innerHTML = `<span>${domain} — ${mins} min/day</span>`;
    const del = document.createElement("button");
    del.className = "budget-item-delete";
    del.textContent = "✕";
    del.onclick = async () => {
      const current = await getBudgets();
      delete current[domain];
      await chrome.storage.local.set({ siteBudgets: current });
      renderBudgetList(current);
    };
    item.appendChild(del);
    budgetList.appendChild(item);
  });
}

budgetAddBtn.addEventListener("click", async () => {
  const domain = budgetDomainInput.value.trim().toLowerCase().replace(/^https?:\/\//, "");
  const mins = parseInt(budgetMinsInput.value, 10);
  if (!domain || !mins || mins < 1) return;

  const existing = await getBudgets();
  existing[domain] = mins * 60;
  await chrome.storage.local.set({ siteBudgets: existing });
  budgetDomainInput.value = "";
  budgetMinsInput.value = "";
  renderBudgetList(existing);
});

budgetClearAll.addEventListener("click", async () => {
  await chrome.storage.local.set({ siteBudgets: {} });
  renderBudgetList({});
});

// Load budgets on init
getBudgets().then(renderBudgetList);

// Initialize
const init = async () => {
  const result = await chrome.storage.session.get(["userIntent", "lastScore"]);
  if (result.userIntent) {
    showDashboard(result.userIntent);
    if (result.lastScore !== undefined) updateScoreUI(result.lastScore);
  } else {
    showIntentSelection();
  }
};

// UI Transitions
const showIntentSelection = () => {
  viewDashboard.classList.remove("active");
  viewBudgets.classList.remove("active");
  viewIntent.classList.add("active");
  // Update nav tab
  navTabs.forEach((t) => t.classList.remove("active"));
  document.querySelector<HTMLButtonElement>('[data-target="view-intent"]')?.classList.add("active");
};

const showDashboard = (intent: string) => {
  currentIntentDisplay.innerText = intent;
  viewIntent.classList.remove("active");
  viewBudgets.classList.remove("active");
  viewDashboard.classList.add("active");
  // Update nav tab
  navTabs.forEach((t) => t.classList.remove("active"));
  document.querySelector<HTMLButtonElement>('[data-target="view-dashboard"]')?.classList.add("active");
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
  await chrome.storage.session.remove(["userIntent", "lastScore"]);
  
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
