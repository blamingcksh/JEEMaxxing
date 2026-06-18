# ⚡ JEEMaxxing (v2.0) — Cognitive Architecture & Spaced Repetition Engine

JEEMaxxing is an elite, client-side productivity command center designed to optimize preparation efficiency for advanced engineering and national examinations. By integrating a multi-variable variant of the SuperMemo-2 (SM-2) algorithm, dynamic real-time SVG charting, automatic diurnal telemetry tracking, and an asynchronous Google Drive sync framework, the system provides pure execution feedback loops while keeping all data stored locally.

---

## 🧭 System Architecture & Module Tree

The application is structured entirely via vanilla ES6 modules to enforce separation of concerns, maximize scannability, and prevent cross-module circular dependencies:

jeemaxxing/
├── index.html                  # Core viewport structure, interface slots, and bootstrap scripts
├── css/
│   └── styles.css              # Premium dark theme stylesheet and responsive grid layout configurations
└── js/
├── app.js                  # Orchestration layer, UI registrations, and hot-reload hooks
├── storage.js              # Persistence matrix, IndexedDB atomic wrappers, and SM-2 math engine
├── matrix.js               # Error Matrix UI compilation, SVG decay arrays, and priority filters
└── pomodoro.js             # Deep Focus stopwatch engines, countdown loops, and audio triggers

---

## ☣️ Spaced Repetition Matrix & Telemetry

### 1. Multi-Variable SM-2 Progression Variant
Unlike baseline flashcard systems, JEEMaxxing calculates your upcoming execution intervals ($I_{\text{next}}$) and Ease Factors ($EF$) on multiple data vectors:

* **Friction Severity Weight ($W_f$):** Evaluated automatically on submission. The system maps your active mistakes (`CALC`, `FORMULA`, `CONCEPT`, `APPROACH`) and isolates the worst-case layer to protect your memory intervals from decay.
* **Performance Quality ($q$):** Computes an algorithmic score between `0.0` and `5.0` by evaluating your autonomy level against execution speed ratios ($R_t = \text{Time Spent} / \text{Target Time}$).
* **Dynamic Combo Convergence:** On practice log completion, the system dynamically swaps the parent card's primary display tag into the most severe active friction type to keep filter categories responsive to current execution traits.

### 2. Weighted Daily Core Queue
Clicking the `⚡ Daily Queue` filter button scans your entire question bank and compiles a strict, curated 20-problem challenge set across all subjects. It sorts items by your **lowest Ease Factor first** (highest cognitive vulnerability) and slices them according to paper distribution targets:
* **Physics:** Top 5 highest vulnerability items
* **Maths:** Top 5 highest vulnerability items
* **Chemistry:** Top 10 highest vulnerability items

---

## 📈 Real-Time Dashboard Diagnostics

### 1. SVG Chapter Decay Grid
A real-time diagnostic health bar that maps out structural chapter health dynamically. The engine evaluates aggregate chapter data via:
$$\text{Health \%} = \text{CLAMP}\left(10, 100, \left(\frac{\text{Average EF} - 1.3}{1.7} \times 100\right) - (\text{Overdue Count} \times 15)\right)$$
Chapters maintaining pristine execution glow emerald green with an active CSS blur drop-glow, while unreviewed or failing chapters decay into a high-visibility crimson warning strip.

### 2. Error Resolution Matrix
Tracks today's mistake overrides per subject independently from your daily problem volume pool. It parses entries natively from your history timelines and charts your progress against separate error-correction targets via a translucent 15-day smooth SVG sparkline with linear-gradient shading masks.

---

## ⚙️ Decoupled Configurations & Storage

### 1. Target Independence & Daily Lockouts
Daily question pools and mistake resolution targets are fully decoupled across the persistence layer:
* **Daily Output Targets:** Set volume limits via `#set-tgt-[subject]` stored in IndexedDB.
* **Daily Error Resolution Targets:** Set mistake limits via `#set-err-[subject]` stored under separate database keys (`baseErrPhys`, `baseErrChem`, `baseErrMath`).
Both systems are tied to a strict 24-hour verification lock (`jeeTargetLockDate`) to enforce structural daily accountability.

### 2. Hybrid Asynchronous Cloud Sync
All system data is securely persisted locally using an asynchronous IndexedDB store layer (`jeemaxxing_db`). When an active Google Drive token is present, the app initializes a cloud-folder handshake to compile and mirror lightweight state payloads (`system_state.json`) and media folders up to your private cloud backup storage automatically.

---

## 🚀 How to Launch Locally

Since the module tree uses strict native ECMAScript imports (`import / export`), browsers block file-system access due to CORS restrictions if you try to open `index.html` directly from a folder. 

You must spin up a lightweight local server to run the application workspace:

### Option A: Python (Quickest)
Open your terminal inside the project directory and run:
```bash
# Python 3
python -m http.server 8000
Then navigate to http://localhost:8000 in your web browser.

Option B: VS Code Live Server
Open the project root folder inside VS Code.

Click Go Live in the bottom status bar (or right-click index.html and select Open with Live Server).
