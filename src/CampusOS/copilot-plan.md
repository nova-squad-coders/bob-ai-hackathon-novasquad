# CampusOS Copilot — Implementation Plan

## Top-Level Overview

Add an isolated **AI Copilot module** to CampusOS that reads student data from the
existing IndexedDB stores (Tasks, Attendance, Spendee/finances, Performance), builds
a minimal context snapshot relevant to the student's question, and returns a
grounded answer from the Gemini API.

**Scope constraints:**
- No existing file is restructured or refactored — only minimal, additive changes.
- All existing UI, design tokens, animations, and module functionality are preserved.
- The Copilot never writes to any existing store and never mutates existing records.
- The Gemini API key never appears in any committed file.
- All new UI is built exclusively from existing CSS design tokens and component classes.

**Approach summary:**
The Copilot is a new, self-contained module (`js/copilot/`) with its own page
(`pages/copilot.html`) and stylesheet (`css/copilot.css`). It plugs into the
existing app via a one-line entry in `CONFIG.modules` (which makes the sidebar link
appear automatically) and a small API-key section in Settings. The data flow is:

  question → intent classifier → context builder → prompt assembler → Gemini fetch → rendered answer

---

## Sub-Task 1 — API Key Infrastructure

**Status:** [ ] pending

**Intent:**
Establish the secure API key handling pattern before any copilot logic is written.
This ensures no key is ever accidentally committed, and gives the Settings-based key
storage path a place to land so Sub-Task 4 (Settings) can reference it.

**Expected Outcomes:**
- `.gitignore` has an entry for `js/copilot/config.local.js`.
- A committed example file `js/copilot/config.local.example.js` shows the expected
  shape (with a placeholder value, never a real key).
- The copilot module's key-loading convention is documented in the example file.

**Todo List:**
1. Add `js/copilot/config.local.js` to `src/CampusOS/.gitignore`.
2. Create `src/CampusOS/js/copilot/config.local.example.js` — exports a constant
   `GEMINI_API_KEY` set to the string `'YOUR_GEMINI_API_KEY_HERE'` with a comment
   explaining that this file must be copied to `config.local.js` and the real key
   inserted before the Copilot feature will work.

**Relevant Context:**
- `src/CampusOS/.gitignore` — currently contains `.DS_Store`, `node_modules/`, etc.
- The real key-loading logic (trying `config.local.js` first, falling back to
  `getConfigValue('copilotApiKey')`) will be implemented in Sub-Task 3 inside
  `copilot.js`. This sub-task only creates the infrastructure files.

---

## Sub-Task 2 — Module Registration

**Status:** [ ] pending

**Intent:**
Register the Copilot as an active module in `CONFIG.modules` so the sidebar link
appears automatically on every page without touching any individual page's HTML.
This is the exact pattern the codebase documents in `README.md` for adding modules.

**Expected Outcomes:**
- "Copilot" appears in the sidebar on every page, linking to `pages/copilot.html`.
- The sidebar renders a distinct icon for the Copilot entry.
- No existing module entry is changed.

**Todo List:**
1. Open `src/CampusOS/js/core/config.js`.
2. Add one object at the end of the `CONFIG.modules` array (before the closing `]`):
   `{ id: 'copilot', label: 'AI Copilot', icon: 'sparkle', href: 'pages/copilot.html', status: 'active' }`.
3. Open `src/CampusOS/js/core/navigation.js` and add the SVG path for the `'sparkle'`
   icon into the `ICONS` object — a simple star/wand shape that does not conflict with
   any existing icon name. Use the same inline SVG path format as every other icon in
   that object (no external dependencies, no `<img>` tags).

**Relevant Context:**
- `src/CampusOS/js/core/config.js` — `CONFIG.modules` array, lines 115–126.
- `src/CampusOS/js/core/navigation.js` — `ICONS` object, lines 11–26. The icon
  function at line 28 wraps any ICONS entry in an `<svg>` tag automatically; only
  the inner path string needs to be added.
- No `db.version` bump is needed — this sub-task adds no new IndexedDB store.

---

## Sub-Task 3 — Copilot Core Logic

**Status:** [ ] pending

**Intent:**
Implement the three internal layers of the Copilot as a single, self-contained JS
module: (1) intent classification, (2) context building from IndexedDB, and
(3) prompt assembly + Gemini API call. This is the only file that touches AI logic.

**Expected Outcomes:**
- `js/copilot/copilot.js` exports `initCopilot()`, which renders the chat UI and
  wires up the input form.
- Submitting a question triggers the full pipeline and renders the answer in the UI.
- Only the stores relevant to the detected intent are read from IndexedDB.
- The Gemini API is called via a plain `fetch()` to the REST endpoint — no SDK.
- If no API key is available, the UI shows a clear, actionable error (not a silent fail).
- No existing store data is written to or mutated.
- All rendered text from the AI passes through `escapeHTML()` before touching innerHTML.

**Todo List:**

1. Create `src/CampusOS/js/copilot/index.js`:
   - Single line: `bootstrap('copilot').then(() => runPage(initCopilot))` — identical
     pattern to every other module's entry file.

2. Create `src/CampusOS/js/copilot/copilot.js` with the following sections:

   **a. Key loader** — `async function loadApiKey()`:
   - Dynamically imports `./config.local.js` (try/catch; if the file doesn't exist
     or throws, swallow the error and return null).
   - If the dynamic import returned a non-empty `GEMINI_API_KEY`, return it.
   - Otherwise fall back to `getConfigValue('copilotApiKey', null)` from `db.js`.
   - Returns the key string or `null`.

   **b. Intent classifier** — `function classifyIntent(question)`:
   - Operates on the lowercased question string only — no API call, no DB read.
   - Returns one of five string values: `'attendance'`, `'finance'`, `'tasks'`,
     `'academic'`, or `'general'`.
   - Keyword sets:
     - `attendance`: skip, bunk, class, lecture, attend, attendance, absent, present, percentage
     - `finance`: afford, money, spend, cost, budget, trip, rupee, ₹, expense, debt, owe
     - `tasks`: focus, today, deadline, due, pending, overdue, assignment, exam, submit
     - `academic`: struggling, marks, subject, score, grade, performance, average, exam, test
     - `general`: catch-all when no other bucket matches (or the question is very short)
   - Note: `exam` appears in both `tasks` and `academic`; the function should check
     `finance` and `attendance` first so those two more specific buckets always win
     when their keywords are present, before falling through to the others.

   **c. Context builder** — `async function buildContext(intent)`:
   - Maps the intent to a set of `getAll()` calls (imports from `db.js`):
     - `attendance` → `attendanceSubjects`, `attendanceLog`
     - `finance` → `transactions`, `debts`
     - `tasks` → `tasks`
     - `academic` → `performance`
     - `general` → `tasks`, `transactions`, `performance`, `attendanceSubjects`
       (light summary of all four — never the raw full arrays)
   - For each loaded dataset, applies a minimal transformation into a concise
     human-readable summary string (e.g. "Subject: Maths — 68% attendance,
     need 75%. Safe to skip: 0 more."). This is the same math already implemented
     in `attendance.js` (safeToSkip, classesNeeded) — recompute it here, do not
     import from that module.
   - For `general` intent, caps each dataset at 5 most-recent or most-relevant
     records to avoid a bloated prompt.
   - Returns a single formatted string: the student context block.

   **d. Prompt assembler** — `function buildPrompt(contextBlock, question)`:
   - Returns the full text string to send to Gemini.
   - System framing (first paragraph): "You are a helpful student assistant for
     CampusOS. Answer ONLY based on the student data provided below. Do not
     invent any numbers, grades, or facts. If the data is insufficient to answer,
     say so honestly. Be concise — 2–4 sentences maximum. The student is an Indian
     college student; currency is INR (₹)."
   - Then the context block under a "--- Student Data ---" heading.
   - Then the student's question under a "--- Question ---" heading.

   **e. Gemini fetch** — `async function askGemini(apiKey, promptText)`:
   - POSTs to `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`
   - Request body: `{ contents: [{ role: 'user', parts: [{ text: promptText }] }], generationConfig: { maxOutputTokens: 512, temperature: 0.4 } }`
   - On HTTP error, throws with the status code and response body included in the
     message so it surfaces usefully in the UI.
   - Returns the answer string extracted from `response.candidates[0].content.parts[0].text`.

   **f. UI renderer** — `function renderCopilotShell(mount)`:
   - Writes the chat shell HTML into the provided mount element using only existing
     CSS classes and design tokens — `.card`, `.btn`, `.btn--primary`, `.empty-state`,
     `.badge`, and new classes defined in `css/copilot.css` (Sub-Task 5).
   - Structure: a scrollable message list (`#copilot-messages`), then a fixed-bottom
     input row with a textarea and a Send button.
   - No hardcoded colors — use `var(--surface)`, `var(--ink)`, `var(--accent)`, etc.

   **g. Chat controller** — `function bindChat(apiKey)`:
   - Wires the Send button and Enter-key (Shift+Enter = newline) on the textarea.
   - On submit: appends a user message bubble, runs the pipeline
     (classifyIntent → buildContext → buildPrompt → askGemini), appends the
     assistant response bubble, scrolls the list to the bottom.
   - Shows a loading state (disabled send button + "Thinking…" bubble) while awaiting.
   - On error: replaces the loading bubble with an error message styled with
     `var(--danger)`.

   **h. initCopilot** — `export async function initCopilot()`:
   - Calls `loadApiKey()`.
   - If key is null, renders a "no API key configured" empty state with a link to
     Settings — does not attempt to call Gemini.
   - Otherwise renders the chat shell and calls `bindChat(apiKey)`.

**Relevant Context:**
- `src/CampusOS/js/core/db.js` — `getAll`, `getConfigValue` (the only two db.js
  functions this module needs).
- `src/CampusOS/js/core/app.js` — `bootstrap`, `runPage` (imported by index.js).
- `src/CampusOS/js/core/utils.js` — `escapeHTML`, `formatDate`, `formatCurrency`,
  `daysBetween` (reuse all of these).
- `src/CampusOS/js/core/notifications.js` — `toast` for non-blocking error feedback.
- `src/CampusOS/js/core/config.js` — `CONFIG.stores` for store name constants.
- `src/CampusOS/js/attendance/attendance.js` — lines 38–54 for the attendance math
  formulas (recompute, do not import from there).
- The `?v=5` cache-bust suffix must be appended to all local imports, consistent
  with every other module in the project.

---

## Sub-Task 4 — Settings Integration

**Status:** [ ] pending

**Intent:**
Add a "Copilot" section to the Settings page where the user can enter and save their
Gemini API key into the `appConfig` store. This is the production key path for
anyone who doesn't have a `config.local.js` file.

**Expected Outcomes:**
- Settings page shows a "CampusOS Copilot" section below Data Management.
- The user can type a Gemini API key and save it — stored via `setConfigValue('copilotApiKey', ...)`.
- On page load, if a key is already saved, the input shows a masked placeholder
  (e.g. `"Key saved — paste a new one to replace it"`) rather than exposing the key.
- Saving a blank value clears the stored key (so the user can revoke it).
- A "Test" button optionally verifies the key with a trivial Gemini request.
- No existing Settings behavior is changed.

**Todo List:**

1. Open `src/CampusOS/pages/settings.html`.
2. Add a new `<div class="section-title">CampusOS Copilot</div>` and a `.card`
   block below the existing Data Management section (before the closing `</main>`).
   The card contains: a label row ("Gemini API Key"), a password-type `<input>`
   with `id="copilot-key-input"`, and a "Save key" `<button>` with `id="copilot-key-save-btn"`.
   Match the exact inline style pattern of the existing Settings cards.
3. Open `src/CampusOS/js/settings/settings.js`.
4. Import `getConfigValue` and `setConfigValue` from `../core/db.js?v=5`.
5. Add a `renderCopilotSettings()` async function that:
   - Reads the existing key via `getConfigValue('copilotApiKey', null)`.
   - If a key exists, sets the input placeholder to `"Key saved — paste a new one to replace it"` and leaves the input empty.
   - Wires the Save button: trims the input value; if non-empty calls
     `setConfigValue('copilotApiKey', value)` and `toast('Copilot API key saved.', 'success')`;
     if empty calls `setConfigValue('copilotApiKey', '')` and
     `toast('Copilot API key cleared.', 'info')`.
6. Call `await renderCopilotSettings()` at the end of the existing `initSettings()` function.

**Relevant Context:**
- `src/CampusOS/pages/settings.html` — existing card pattern to match, lines 27–84.
- `src/CampusOS/js/settings/settings.js` — `initSettings()` at line 12; existing
  import block at lines 5–10 (add `getConfigValue`, `setConfigValue` to the db.js import).
- `src/CampusOS/js/core/db.js` — `getConfigValue` (line 167), `setConfigValue` (line 172).

---

## Sub-Task 5 — Copilot Page and Styles

**Status:** [ ] pending

**Intent:**
Create the HTML page that hosts the Copilot and the CSS that styles the chat UI.
All visual decisions use existing design tokens only — this sub-task introduces no
new colors, no new spacing values, and no new animation keyframes.

**Expected Outcomes:**
- `pages/copilot.html` exists and follows the exact shell structure of every other
  module page (same `app-shell`, `sidebar`, `topbar`, `page-content` structure).
- `css/copilot.css` exists and contains only copilot-specific classes that
  reference existing tokens.
- The chat page is responsive, respects light/dark theme automatically (via CSS vars),
  and entrance animations use the existing `animate-in` / `rise-in` classes.

**Todo List:**

1. Create `src/CampusOS/pages/copilot.html`:
   - Boilerplate identical to `pages/tasks.html` (same head, same `app-shell` skeleton).
   - Title: `"AI Copilot — CampusOS"`.
   - `<main class="page-content">` contains:
     - A `.page-header` with title "AI Copilot" and subtitle "Ask anything about your tasks, attendance, spending, or grades."
     - A `<div id="copilot-mount"></div>` where `initCopilot()` renders everything.
   - CSS links: same four as every module page (`tokens.css`, `base.css`,
     `components.css`, `page.css`) plus `../css/copilot.css?v=1`.
   - Script: `<script type="module" src="../js/copilot/index.js?v=1"></script>`.

2. Create `src/CampusOS/css/copilot.css`:
   - `.copilot-shell` — flex column, full height of its container, `min-height: 60vh`.
   - `.copilot-messages` — scrollable flex column (`overflow-y: auto`, `flex: 1`),
     `gap: var(--space-4)`, `padding: var(--space-4) 0`.
   - `.copilot-bubble` — `max-width: 80%`, `border-radius: var(--radius-md)`,
     `padding: var(--space-3) var(--space-4)`, `font-size: var(--text-sm)`,
     `line-height: var(--leading-relaxed)`. Uses `animate-in` for entrance.
   - `.copilot-bubble--user` — align-self flex-end, `background: var(--accent)`,
     `color: #241705` (same dark text the `.btn--primary` uses against the amber background).
   - `.copilot-bubble--assistant` — align-self flex-start, `background: var(--surface)`,
     `border: 1px solid var(--surface-border)`, `color: var(--ink)`.
   - `.copilot-bubble--error` — `background: rgba(193,87,63,0.10)`,
     `border: 1px solid var(--danger)`, `color: var(--danger)`.
   - `.copilot-input-row` — flex row, `gap: var(--space-3)`, `padding-top: var(--space-4)`,
     `border-top: 1px solid var(--surface-border)`, `align-items: flex-end`.
   - `.copilot-textarea` — `flex: 1`, `resize: none`, `border-radius: var(--radius-sm)`,
     `border: 1px solid var(--surface-border)`, `background: var(--surface)`,
     `padding: var(--space-3) var(--space-4)`, `font-family: var(--font-body)`,
     `font-size: var(--text-sm)`, `color: var(--ink)`, `min-height: 44px`,
     `max-height: 120px`.
   - `.copilot-textarea:focus` — `outline: 2px solid var(--accent)`,
     `outline-offset: 2px`, `border-color: transparent`.
   - `.copilot-send-btn` — use `.btn.btn--primary` sizing, no additional overrides needed;
     this class exists purely as a semantic hook if future changes are needed.
   - Responsive: on `max-width: 640px`, set `.copilot-bubble` max-width to `92%`.

**Relevant Context:**
- `src/CampusOS/pages/tasks.html` — the exact HTML shell pattern to copy (lines 1–66).
- `src/CampusOS/css/tokens.css` — all token names, animation keyframes (`rise-in`,
  `animate-in`), and the `#241705` dark text value used by `.btn--primary`.
- `src/CampusOS/css/components.css` — `.card`, `.btn`, `.btn--primary`, `.empty-state`
  are all available to copilot.js-rendered HTML without any new CSS.

---

## Sub-Task 6 — Suggested Questions and Polish

**Status:** [ ] pending

**Intent:**
Add example question chips to the Copilot's empty/welcome state so first-time users
know what to ask. Also add a "Clear chat" button and ensure the loading state is
accessible. This sub-task is cosmetic and purely additive — it only touches
`copilot.js` and `copilot.css`.

**Expected Outcomes:**
- On first load (empty message list), the Copilot shows 4 example question chips.
- Clicking a chip populates the textarea and immediately submits.
- A "Clear chat" button appears in the page header area once at least one message exists.
- The "Thinking…" loading bubble uses the existing `--ink-faint` color and an
  animated ellipsis (CSS only, no JS timer).

**Todo List:**

1. In `copilot.js`, define a `SUGGESTED_QUESTIONS` constant array with four strings:
   `"Can I skip tomorrow's class?"`, `"Can I afford a ₹3000 trip this weekend?"`,
   `"What should I focus on today?"`, `"Where am I struggling academically?"`.

2. In `renderCopilotShell()`, add a welcome block above the input row that is shown
   only when the message list is empty: a brief line ("Ask me anything about your
   CampusOS data.") followed by four `.chip` buttons (class already defined in
   `page.css`) for each suggested question.

3. Wire each chip so clicking it sets the textarea value and dispatches a submit.

4. Hide the welcome block after the first message is appended (toggle a CSS class
   or `hidden` attribute).

5. Add a "Clear chat" icon button (using the existing `.icon-button` class from
   `base.css`) to the copilot page header that clears `#copilot-messages` and
   restores the welcome block.

6. Style the "Thinking…" bubble in `copilot.css`: add a `.copilot-bubble--loading`
   modifier that applies a CSS `@keyframes` pulse (opacity 0.4 → 1 → 0.4, 1.4s
   infinite) to its text, so it breathes without JavaScript.

**Relevant Context:**
- `src/CampusOS/css/page.css` — `.chip` class (lines 161–170) is already available.
- `src/CampusOS/css/base.css` — `.icon-button` class is used by the topbar buttons.
- `src/CampusOS/js/core/navigation.js` — `icon('x')` or similar can be used for the
  clear button if an 'x' icon is added to the ICONS map; alternatively use an inline SVG.

---

## Files Summary

### New files to create

| File | Sub-Task |
|---|---|
| `src/CampusOS/js/copilot/config.local.example.js` | 1 |
| `src/CampusOS/js/copilot/index.js` | 3 |
| `src/CampusOS/js/copilot/copilot.js` | 3 |
| `src/CampusOS/pages/copilot.html` | 5 |
| `src/CampusOS/css/copilot.css` | 5 |

### Existing files to modify (additive changes only)

| File | Change | Sub-Task |
|---|---|---|
| `src/CampusOS/.gitignore` | Add `js/copilot/config.local.js` | 1 |
| `src/CampusOS/js/core/config.js` | Add copilot entry to `CONFIG.modules` | 2 |
| `src/CampusOS/js/core/navigation.js` | Add `sparkle` icon to `ICONS` | 2 |
| `src/CampusOS/pages/settings.html` | Add Copilot API key section | 4 |
| `src/CampusOS/js/settings/settings.js` | Add `renderCopilotSettings()` + call | 4 |

### Files NOT touched

All existing module JS/HTML/CSS files (`tasks`, `spendee`, `attendance`,
`performance`, `dashboard`, `people`, `library`, `achievements`, `resume`),
`db.js`, `app.js`, `modal.js`, `notifications.js`, `utils.js`,
`validators.js`, `categories.js`, `search.js`, `theme.js`, `exportImport.js`,
all existing CSS files.

---

## Gemini API Integration

- **Endpoint:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=KEY`
- **Transport:** Direct browser `fetch()` — no SDK, no build step, no proxy.
- **Request shape:** Single user turn containing the assembled prompt text.
  `generationConfig`: `temperature: 0.4`, `maxOutputTokens: 512`.
- **Response parsing:** `data.candidates[0].content.parts[0].text`.
- **No streaming** for V1 — simpler error handling and consistent with the rest of
  the app's async/await patterns.

---

## API Key Handling

| Scenario | Key source |
|---|---|
| Local development | `js/copilot/config.local.js` (gitignored, copied from example) |
| End user / judge | Settings page → saved to `appConfig` store via `setConfigValue` |
| Key priority | `config.local.js` is tried first; `appConfig` is the fallback |
| Key in repo | Never — `config.local.js` is gitignored; `config.local.example.js` has a placeholder only |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gemini API key accidentally committed | Low | `.gitignore` entry + example-only committed file |
| CORS block on Gemini REST from `file://` origin | Medium | Test with a local HTTP server (e.g. `npx serve`); Gemini REST allows browser origins |
| Large context payload hitting token limits | Low | Intent classifier limits context to one domain; `general` intent caps at 5 records per store |
| `config.local.js` dynamic import fails silently in some browsers | Low | The try/catch fallback to `getConfigValue` handles this; error is swallowed, not re-thrown |
| Breaking existing modules via config.js edit | Very low | Only one object is appended to the modules array; existing entries are untouched |
| Prompt injection via user-entered data (task titles, subject names, etc.) | Low | System prompt instructs the model to answer only from provided data; student data is passed as plain text inside a clearly delimited section, not as instructions |
