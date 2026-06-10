# jeemaxxing

A single-file PWA built over a weekend to log errors, parse LaTeX questions, and track prep velocity for JEE Advanced. No backend servers, no subscription paywalls, no tracking bloat.

### 🛑 Code Status: Frozen
Targeting a sub-1000 rank for the JEE Advanced 2027 cycle. The codebase is locked and will remain exactly as it is until the exams are over. No pull requests or issues will be read, reviewed, or merged. 

### Core Mechanics
* **Single-File Monolith:** ~5,000 lines of vanilla HTML, CSS, and JS. Zero build steps, zero npm package overhead. Just open it and run.
* **Local-First:** All statistics, error matrices, and tracking streaks live strictly inside your browser's `localStorage` layer.
* **Google Drive Backup:** Automatically syncs the local state array directly to your own Google Drive account as a `system_state.json` backup file.
* **Sovereign API Keys:** Uses a user-supplied Gemini API key (saved safely in your client browser cache) to run vision OCR question-cropping and local LaTeX math rendering.

Built to get the job done. Back to the modules.



---
*Engineered to eliminate friction. Built to dominate the matrix.*(cool ahh statement)
