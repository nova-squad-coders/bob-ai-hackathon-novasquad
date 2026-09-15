/**
 * copilot.js — CampusOS AI Copilot.
 *
 * Architecture:
 *   user question
 *     → classifyIntent()   (local keyword match, no network)
 *     → buildContext()     (reads only the relevant IndexedDB stores via db.js)
 *     → buildPrompt()      (assembles system framing + student data + question)
 *     → askGemini()        (plain fetch() to Gemini REST — no SDK)
 *     → rendered chat bubble
 *
 * Rules:
 *   - Never writes to any IndexedDB store.
 *   - Never uses fake/hardcoded student data.
 *   - All user-derived text is passed through escapeHTML() before innerHTML.
 *   - API key is never hardcoded here; loaded from config.local.js or appConfig store.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, getConfigValue } from '../core/db.js?v=5';
import { escapeHTML, formatDate, formatCurrency, daysBetween } from '../core/utils.js?v=5';
import { toast } from '../core/notifications.js?v=5';

const S = CONFIG.stores;

// ─── Suggested prompts shown on welcome screen ────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "Can I skip tomorrow's class?",
  'Can I afford a ₹3000 trip this weekend?',
  'What should I focus on today?',
  'Where am I struggling academically?',
];

// ─── localStorage keys and persistence helpers ────────────────────────────────
// All Copilot state lives in localStorage (not IndexedDB) so it is lightweight,
// survives page navigation without a round-trip to the DB, and never interferes
// with CampusOS data stores.

const STORAGE = {
  CHAT:   'campusos:copilot:chat',    // [{role,text}] — message history
  OPEN:   'campusos:copilot:open',    // '1' | '0' — drawer open/closed
  WIDTH:  'campusos:copilot:width',   // e.g. '420' — drawer width in px
};

/** Maximum stored message pairs (user + assistant) to prevent unbounded growth. */
const MAX_STORED_MESSAGES = 40;

/**
 * Persist the current conversation to localStorage.
 * Only 'user' and 'assistant' bubbles are stored — loading/error bubbles
 * are transient and the API key is never touched here.
 * @param {{ role: string, text: string }[]} messages
 */
function saveChatHistory(messages) {
  try {
    // Keep only the last MAX_STORED_MESSAGES entries
    const trimmed = messages.slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(STORAGE.CHAT, JSON.stringify(trimmed));
  } catch { /* localStorage full or unavailable — fail silently */ }
}

/**
 * Restore the conversation from localStorage.
 * @returns {{ role: string, text: string }[] }
 */
function loadChatHistory() {
  try {
    const raw = localStorage.getItem(STORAGE.CHAT);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate shape — only keep entries with a known role and a string text
    return parsed.filter(
      (m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string'
    );
  } catch { return []; }
}

/** Remove all stored chat messages (called by the Clear button). */
function clearChatHistory() {
  try { localStorage.removeItem(STORAGE.CHAT); } catch { /* ignore */ }
}

/** Persist whether the drawer is currently open. */
function saveDrawerOpen(isOpen) {
  try { localStorage.setItem(STORAGE.OPEN, isOpen ? '1' : '0'); } catch { /* ignore */ }
}

/** Returns true if the drawer was open when the user last left. */
function loadDrawerOpen() {
  try { return localStorage.getItem(STORAGE.OPEN) === '1'; } catch { return false; }
}

/** Persist the user's chosen drawer width (pixels, as a number). */
function saveDrawerWidth(px) {
  try { localStorage.setItem(STORAGE.WIDTH, String(px)); } catch { /* ignore */ }
}

/** Returns the stored drawer width in px, or null if none saved. */
function loadDrawerWidth() {
  try {
    const v = localStorage.getItem(STORAGE.WIDTH);
    const n = v ? parseInt(v, 10) : NaN;
    return isNaN(n) ? null : n;
  } catch { return null; }
}

// ─── 1. API key loader ────────────────────────────────────────────────────────

/**
 * Try config.local.js first (local dev), then fall back to the key stored
 * in appConfig via Settings. Returns the key string or null.
 */
async function loadApiKey() {
  // Dynamic import of the gitignored local dev file.
  // If it doesn't exist or throws for any reason, we swallow the error and
  // fall through to the Settings-stored key.
  try {
    const local = await import('./config.local.js');
    if (local && local.GEMINI_API_KEY && local.GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE') {
      return local.GEMINI_API_KEY;
    }
  } catch {
    // File absent or unreadable — expected in production.
  }

  const stored = await getConfigValue('copilotApiKey', null);
  if (stored && stored.trim()) return stored.trim();

  return null;
}

// ─── 2. Intent classifier ─────────────────────────────────────────────────────

/**
 * Classifies a student question into one of five intent buckets based purely
 * on keyword presence. No API call, no DB read.
 *
 * Priority order (most specific first): finance, attendance, tasks, academic, general.
 * 'exam' appears in both tasks and academic keyword sets — since finance and
 * attendance are checked first, those always win when their keywords are present.
 *
 * @param {string} question
 * @returns {'attendance' | 'finance' | 'tasks' | 'academic' | 'general'}
 */
function classifyIntent(question) {
  const q = question.toLowerCase();

  const matches = (keywords) => keywords.some((kw) => q.includes(kw));

  if (matches(['afford', 'money', 'spend', 'cost', 'budget', 'trip', 'rupee', '₹', 'expense', 'debt', 'owe', 'spent', 'saving', 'savings', 'income', 'transaction'])) {
    return 'finance';
  }
  if (matches(['skip', 'bunk', 'class', 'lecture', 'attend', 'attendance', 'absent', 'present', 'percentage', 'proxy', 'holiday'])) {
    return 'attendance';
  }
  if (matches(['focus', 'today', 'deadline', 'due', 'pending', 'overdue', 'assignment', 'submit', 'task', 'to-do', 'todo'])) {
    return 'tasks';
  }
  if (matches(['struggling', 'marks', 'subject', 'score', 'grade', 'performance', 'average', 'exam', 'test', 'result', 'cgpa', 'gpa', 'academic'])) {
    return 'academic';
  }
  return 'general';
}

// ─── 3. Context builder ───────────────────────────────────────────────────────

/** Attendance math helpers — same formulas as attendance.js, recomputed here
 *  so the copilot has no dependency on that module. */
function attendancePct(s) {
  return s.conducted ? (s.attended / s.conducted) * 100 : null;
}

function safeToSkip(s) {
  if (!s.conducted) return null;
  const raw = (s.attended * 100) / s.requiredPercentage - s.conducted;
  return Math.max(0, Math.floor(raw + 1e-9));
}

function classesNeeded(s) {
  const req = s.requiredPercentage || 75;
  const pct = attendancePct(s);
  if (pct !== null && pct >= req) return 0;
  if (req >= 100) return null;
  const raw = (req * s.conducted - 100 * s.attended) / (100 - req);
  return Math.max(0, Math.ceil(raw - 1e-9));
}

/** Build the attendance context block from attendanceSubjects store. */
function buildAttendanceContext(subjects) {
  if (!subjects.length) return 'No attendance data recorded yet.';
  return subjects.map((s) => {
    const pct = attendancePct(s);
    const pctStr = pct !== null ? pct.toFixed(1) + '%' : 'no data';
    const skip = safeToSkip(s);
    const need = classesNeeded(s);
    const req = s.requiredPercentage || 75;
    let line = `Subject: ${s.name} — ${s.attended ?? 0}/${s.conducted ?? 0} classes attended (${pctStr}, required: ${req}%).`;
    if (skip !== null) line += ` Safe to skip: ${skip} more class(es).`;
    if (need && need > 0) line += ` Needs ${need} more class(es) to reach ${req}%.`;
    return line;
  }).join('\n');
}

/** Build finance context from transactions + debts. */
function buildFinanceContext(transactions, debts) {
  if (!transactions.length && !debts.length) return 'No finance data recorded yet.';

  const lines = [];
  const today = new Date();
  const thisMonth = today.getMonth();
  const thisYear = today.getFullYear();

  const monthTx = transactions.filter((t) => {
    const d = new Date(t.date);
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  });
  const spent = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const earned = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);

  lines.push(`This month's spending: ${formatCurrency(spent)}.`);
  if (earned > 0) lines.push(`This month's income: ${formatCurrency(earned)}.`);

  // Unsettled debts
  const unsettled = debts.filter((d) => !d.settled);
  if (unsettled.length) {
    const owedToMe = unsettled.filter((d) => d.direction === 'owed_to_me');
    const iOwe = unsettled.filter((d) => d.direction === 'i_owe');
    const remainingBalance = (d) => {
      const repaid = (d.repayments || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      return Math.max(0, Number(d.amount || 0) - repaid);
    };
    if (owedToMe.length) {
      const total = owedToMe.reduce((s, d) => s + remainingBalance(d), 0);
      lines.push(`Owed to student: ${formatCurrency(total)} across ${owedToMe.length} debt(s).`);
    }
    if (iOwe.length) {
      const total = iOwe.reduce((s, d) => s + remainingBalance(d), 0);
      lines.push(`Student owes: ${formatCurrency(total)} across ${iOwe.length} debt(s).`);
    }
  }

  // Last 5 expenses for context
  const recent = [...transactions]
    .filter((t) => t.type === 'expense')
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);
  if (recent.length) {
    lines.push('Recent expenses:');
    recent.forEach((t) => {
      lines.push(`  - ${formatCurrency(t.amount)} on ${t.category || 'Uncategorised'} (${formatDate(t.date)})`);
    });
  }

  return lines.join('\n');
}

/** Build tasks context. Shows overdue first, then due today, then upcoming 7 days. */
function buildTasksContext(tasks) {
  if (!tasks.length) return 'No tasks recorded yet.';

  const today = new Date();
  const pending = tasks.filter((t) => t.status !== 'completed');
  const overdue = pending.filter((t) => t.dueDate && daysBetween(today, t.dueDate) < 0);
  const dueToday = pending.filter((t) => t.dueDate && daysBetween(today, t.dueDate) === 0);
  const upcoming = pending
    .filter((t) => t.dueDate && daysBetween(today, t.dueDate) > 0 && daysBetween(today, t.dueDate) <= 7)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  const lines = [];
  lines.push(`Total pending tasks: ${pending.length} (${overdue.length} overdue, ${dueToday.length} due today, ${upcoming.length} due this week).`);

  if (overdue.length) {
    lines.push('Overdue tasks:');
    overdue.slice(0, 5).forEach((t) => lines.push(`  - [${t.priority || 'Medium'}] ${t.title} (was due ${formatDate(t.dueDate)})`));
  }
  if (dueToday.length) {
    lines.push('Due today:');
    dueToday.slice(0, 5).forEach((t) => lines.push(`  - [${t.priority || 'Medium'}] ${t.title}`));
  }
  if (upcoming.length) {
    lines.push('Due this week:');
    upcoming.slice(0, 5).forEach((t) => lines.push(`  - [${t.priority || 'Medium'}] ${t.title} (due ${formatDate(t.dueDate)})`));
  }

  return lines.join('\n');
}

/** Build academic performance context. */
function buildAcademicContext(performance) {
  if (!performance.length) return 'No academic performance data recorded yet.';

  const lines = [];

  // Overall average
  const overall = performance.reduce((s, p) => s + (Number(p.obtainedMarks) / Number(p.maxMarks)) * 100, 0) / performance.length;
  lines.push(`Overall academic average: ${overall.toFixed(1)}%.`);

  // Per-subject averages
  const bySubject = {};
  performance.forEach((p) => {
    if (!bySubject[p.subject]) bySubject[p.subject] = [];
    bySubject[p.subject].push((Number(p.obtainedMarks) / Number(p.maxMarks)) * 100);
  });

  lines.push('Performance by subject:');
  Object.entries(bySubject)
    .map(([sub, scores]) => ({ sub, avg: scores.reduce((a, b) => a + b, 0) / scores.length }))
    .sort((a, b) => a.avg - b.avg) // weakest first — most useful for "where struggling"
    .forEach(({ sub, avg }) => {
      lines.push(`  - ${sub}: ${avg.toFixed(1)}% average`);
    });

  // Most recent 5 entries
  const recent = [...performance].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  lines.push('Recent assessments:');
  recent.forEach((p) => {
    const pct = ((Number(p.obtainedMarks) / Number(p.maxMarks)) * 100).toFixed(1);
    lines.push(`  - ${p.subject} ${p.assessmentType}: ${p.obtainedMarks}/${p.maxMarks} (${pct}%) on ${formatDate(p.date)}`);
  });

  return lines.join('\n');
}

/**
 * Main context builder. Reads only the stores relevant to the detected intent.
 * For 'general' intent, loads all four domains but caps each to 5 records.
 *
 * @param {'attendance'|'finance'|'tasks'|'academic'|'general'} intent
 * @returns {Promise<string>} formatted student context block
 */
async function buildContext(intent) {
  const parts = [];

  if (intent === 'attendance' || intent === 'general') {
    const subjects = await safeGetAll(S.attendanceSubjects.name);
    parts.push('=== ATTENDANCE ===\n' + buildAttendanceContext(subjects));
  }

  if (intent === 'finance' || intent === 'general') {
    const [transactions, debts] = await Promise.all([
      safeGetAll(S.transactions.name),
      safeGetAll(S.debts.name),
    ]);
    // For general intent, cap transactions to the 5 most recent
    const txSlice = intent === 'general' ? [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5) : transactions;
    parts.push('=== FINANCE ===\n' + buildFinanceContext(txSlice, debts));
  }

  if (intent === 'tasks' || intent === 'general') {
    const tasks = await safeGetAll(S.tasks.name);
    parts.push('=== TASKS ===\n' + buildTasksContext(tasks));
  }

  if (intent === 'academic' || intent === 'general') {
    const performance = await safeGetAll(S.performance.name);
    parts.push('=== ACADEMIC PERFORMANCE ===\n' + buildAcademicContext(performance));
  }

  return parts.join('\n\n');
}

async function safeGetAll(storeName) {
  try {
    return await getAll(storeName);
  } catch {
    return [];
  }
}

// ─── 4. Prompt assembler ──────────────────────────────────────────────────────

/**
 * Builds the full prompt string sent to Gemini.
 * The system framing is embedded in the single user turn since Gemini's
 * REST API accepts plain text in the user role.
 */
function buildPrompt(contextBlock, question) {
  return `You are a helpful student assistant for CampusOS, a personal student productivity app.
Answer ONLY based on the student data provided below. Do not invent any numbers, grades, amounts, or facts.
If the data is insufficient to answer the question, say so honestly and briefly.
Be concise — 2 to 4 sentences maximum. Avoid bullet points unless they genuinely help.
The student is an Indian college student; currency is INR (₹).

--- Student Data ---
${contextBlock}

--- Question ---
${question}`;
}

// ─── 5. Gemini API call ───────────────────────────────────────────────────────

/**
 * Sends the prompt to Gemini using the current Interactions API.
 * Uses plain fetch() — no SDK dependency.
 *
 * Endpoint : POST https://generativelanguage.googleapis.com/v1beta/interactions
 * Auth     : x-goog-api-key header (key loaded from appConfig, never hardcoded)
 * Model    : gemini-3.6-flash
 *
 * Request body  : { model: "gemini-3.6-flash", input: "<prompt text>" }
 * Response text : data.output (string) returned by the Interactions API.
 *
 * @param {string} apiKey
 * @param {string} promptText
 * @returns {Promise<string>}
 */
async function askGemini(apiKey, promptText) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/interactions';
  const body = {
    model: 'gemini-3.6-flash',
    input: promptText,
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error(`Network error — could not reach Gemini. Check your internet connection. (${networkErr.message})`);
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || ''; } catch { /* ignore */ }
    throw new Error(`Gemini API error ${res.status}${detail ? ': ' + detail : '.'}`);
  }

  const data = await res.json();
  // Extract text from the Interactions API response.
  // The response shape is: { output: { parts: [{ text: "..." }], role: "model" } }
  // data.output is a Content object, not a plain string.
  const text = extractTextFromResponse(data);
  if (!text) {
    // Surface the actual structure for debugging rather than a generic message.
    const shape = JSON.stringify(data).slice(0, 300);
    throw new Error(`Gemini returned no readable text. Response shape: ${shape}`);
  }
  return text;
}

/**
 * Safely extracts the model's text from a Gemini Interactions API response.
 *
 * PRIMARY path — confirmed actual Interactions API response shape:
 *   data.steps[]
 *     → step.type === "model_output"
 *     → step.content[]
 *       → content.type === "text" && content.text (non-empty string)
 *   All matching text parts are joined with "\n".
 *
 * FALLBACK paths (defensive, for API shape changes or legacy endpoints):
 *   F1. data.output is a plain string
 *   F2. data.output.parts[].text  (Content object)
 *   F3. data.output.content.parts[].text  (nested Content)
 *   F4. data.candidates[0].content.parts[].text  (legacy generateContent)
 */
function extractTextFromResponse(data) {
  // PRIMARY: data.steps[] → model_output → content[].text
  if (Array.isArray(data?.steps)) {
    const parts = [];
    for (const step of data.steps) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
            parts.push(item.text);
          }
        }
      }
    }
    if (parts.length > 0) return parts.join('\n').trim();
  }

  // F1: output is a plain string
  if (typeof data?.output === 'string' && data.output.trim()) {
    return data.output.trim();
  }

  // F2: output is { parts: [{ text }], role }
  if (data?.output?.parts) {
    const joined = data.output.parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }

  // F3: output.content holds the Content object
  if (data?.output?.content?.parts) {
    const joined = data.output.content.parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }

  // F4: legacy generateContent response shape
  if (data?.candidates?.[0]?.content?.parts) {
    const joined = data.candidates[0].content.parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }

  return null;
}

// ─── 6. Chat UI ───────────────────────────────────────────────────────────────

/**
 * Appends a message bubble to the message list and scrolls to it.
 *
 * @param {HTMLElement} list  - the #copilot-messages element
 * @param {string} text       - the message text (will be escapeHTML'd)
 * @param {'user'|'assistant'|'error'|'loading'} role
 * @returns {HTMLElement}     - the created bubble element
 */
function appendBubble(list, text, role) {
  const bubble = document.createElement('div');
  bubble.className = `copilot-bubble copilot-bubble--${role} animate-in`;
  // Loading bubble gets a special aria label; all others get their text
  if (role === 'loading') {
    bubble.setAttribute('aria-label', 'Thinking…');
    bubble.innerHTML = '<span class="copilot-loading-dots"><span></span><span></span><span></span></span>';
  } else {
    // Preserve line breaks in AI responses by replacing \n with <br>
    const safe = escapeHTML(text).replace(/\n/g, '<br>');
    bubble.innerHTML = safe;
  }
  list.appendChild(bubble);
  bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return bubble;
}

/**
 * Renders the full Copilot shell HTML into the given mount element.
 * Uses only existing CSS classes + tokens and classes defined in copilot.css.
 */
function renderCopilotShell(mount) {
  const chips = SUGGESTED_QUESTIONS.map((q) =>
    `<button class="chip copilot-suggestion-chip" type="button">${escapeHTML(q)}</button>`
  ).join('');

  mount.innerHTML = `
    <div class="copilot-shell card" style="padding: var(--space-5);">
      <div id="copilot-welcome" class="copilot-welcome">
        <p class="copilot-welcome__text">Ask me anything about your CampusOS data — tasks, attendance, spending, or grades.</p>
        <div class="copilot-chips">${chips}</div>
      </div>

      <div id="copilot-messages" class="copilot-messages" role="log" aria-live="polite" aria-label="Conversation"></div>

      <div class="copilot-input-row">
        <textarea
          id="copilot-textarea"
          class="copilot-textarea"
          placeholder="Ask something about your tasks, attendance, money, or grades…"
          rows="1"
          aria-label="Your question"
        ></textarea>
        <button id="copilot-send-btn" class="btn btn--primary copilot-send-btn" type="button" aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22 11 13 2 9l20-7z"/></svg>
        </button>
      </div>

      <div id="copilot-clear-row" class="copilot-clear-row" hidden>
        <button id="copilot-clear-btn" class="btn btn--ghost" type="button" style="font-size: var(--text-xs);">Clear conversation</button>
      </div>
    </div>
  `;

  // ── Restore saved conversation ──────────────────────────────────────────
  const history = loadChatHistory();
  if (history.length > 0) {
    const messageList = mount.querySelector('#copilot-messages');
    const welcome = mount.querySelector('#copilot-welcome');
    const clearRow = mount.querySelector('#copilot-clear-row');
    history.forEach(({ role, text }) => appendBubble(messageList, text, role));
    if (welcome) welcome.hidden = true;
    if (clearRow) clearRow.hidden = false;
  }
}

/**
 * Renders the "no API key" empty state instead of the chat shell.
 */
function renderNoKeyState(mount, settingsHref) {
  const href = settingsHref || (window.location.pathname.includes('/pages/') ? '../pages/settings.html' : 'pages/settings.html');
  mount.innerHTML = `
    <div class="empty-state" style="padding: var(--space-6);">
      <span class="empty-state__title">Gemini API key not configured</span>
      <span class="empty-state__body">
        The AI Copilot needs a Gemini API key to answer questions. Add your key in Settings to get started.
        The key is stored only in this browser — it is never sent anywhere except directly to the Gemini API.
      </span>
      <a class="empty-state__action btn btn--primary" href="${href}" style="margin-top: var(--space-4); text-decoration: none;">
        Go to Settings →
      </a>
    </div>
  `;
}

/**
 * Wires the send button, Enter key, suggestion chips, and clear button.
 * Runs the full intent → context → prompt → Gemini pipeline on each submit.
 */
function bindChat(apiKey) {
  const textarea = document.getElementById('copilot-textarea');
  const sendBtn = document.getElementById('copilot-send-btn');
  const messageList = document.getElementById('copilot-messages');
  const welcome = document.getElementById('copilot-welcome');
  const clearRow = document.getElementById('copilot-clear-row');
  const clearBtn = document.getElementById('copilot-clear-btn');

  // Auto-grow textarea as the user types (up to the max-height set in CSS)
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  /** Collect all currently visible user/assistant messages as plain objects. */
  function collectMessages() {
    return Array.from(messageList.querySelectorAll(
      '.copilot-bubble--user, .copilot-bubble--assistant'
    )).map((el) => ({
      role: el.classList.contains('copilot-bubble--user') ? 'user' : 'assistant',
      // innerHTML uses <br> for line breaks — convert back to \n for storage
      text: el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    }));
  }

  async function submit() {
    const question = textarea.value.trim();
    if (!question) return;

    // Hide welcome block on first message
    if (welcome && !welcome.hidden) welcome.hidden = true;
    if (clearRow) clearRow.hidden = false;

    // Render user bubble
    appendBubble(messageList, question, 'user');
    textarea.value = '';
    textarea.style.height = 'auto';
    sendBtn.disabled = true;

    // Show loading bubble
    const loadingBubble = appendBubble(messageList, '', 'loading');

    try {
      const intent = classifyIntent(question);
      const contextBlock = await buildContext(intent);
      const prompt = buildPrompt(contextBlock, question);
      const answer = await askGemini(apiKey, prompt);

      loadingBubble.remove();
      appendBubble(messageList, answer, 'assistant');
      // Persist the conversation after a completed exchange
      saveChatHistory(collectMessages());
    } catch (err) {
      loadingBubble.remove();
      appendBubble(messageList, err.message || 'Something went wrong. Please try again.', 'error');
      toast(err.message || 'Copilot error.', 'error', 6000);
    } finally {
      sendBtn.disabled = false;
      textarea.focus();
    }
  }

  sendBtn.addEventListener('click', submit);

  // Enter submits; Shift+Enter inserts a newline
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });

  // Suggestion chips
  document.querySelectorAll('.copilot-suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      textarea.value = chip.textContent;
      textarea.dispatchEvent(new Event('input')); // trigger auto-grow
      submit();
    });
  });

  // Clear conversation — also wipes localStorage
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      messageList.innerHTML = '';
      clearChatHistory();
      if (welcome) welcome.hidden = false;
      if (clearRow) clearRow.hidden = true;
    });
  }
}

// ─── 7. Module entry points ───────────────────────────────────────────────────

/**
 * Called by runPage() from index.js — renders the copilot into the dedicated
 * copilot page's #copilot-mount element.
 */
export async function initCopilot() {
  const mount = document.getElementById('copilot-mount');
  if (!mount) return;

  const apiKey = await loadApiKey();

  if (!apiKey) {
    renderNoKeyState(mount);
    return;
  }

  renderCopilotShell(mount);
  bindChat(apiKey);
}

/**
 * initCopilotFloat — injects the floating AI Copilot button and panel into
 * every CampusOS page. Called once from bootstrap() in app.js.
 *
 * The FAB and panel are created entirely in JS so no HTML template changes
 * are needed on any existing page. All existing copilot logic (loadApiKey,
 * renderCopilotShell, renderNoKeyState, bindChat) is reused unchanged.
 */
export function initCopilotFloat() {
  // Guard: only inject once per page
  if (document.getElementById('copilot-fab')) return;

  // ── Inject the copilot stylesheet if not already present ───────────────
  // copilot.css is referenced explicitly in pages/copilot.html, but the FAB
  // appears on every page so we inject the link tag here for all others.
  const isInPages = window.location.pathname.includes('/pages/');
  const cssPrefix = isInPages ? '../' : '';
  if (!document.querySelector('link[href*="copilot.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${cssPrefix}css/copilot.css?v=1`;
    document.head.appendChild(link);
  }

  // ── Resolve the correct Settings href from any page depth ──────────────
  const settingsHref = isInPages ? '../pages/settings.html' : 'pages/settings.html';

  // ── Build the FAB ───────────────────────────────────────────────────────
  const fab = document.createElement('button');
  fab.id = 'copilot-fab';
  fab.className = 'copilot-fab';
  fab.setAttribute('aria-label', 'Open AI Copilot');
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'copilot-float-panel');
  fab.innerHTML = `
    <svg class="copilot-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
    </svg>
    <span class="copilot-fab__label">AI Copilot</span>
  `;

  // ── Build the floating panel ────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'copilot-float-panel';
  panel.className = 'copilot-float-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'AI Copilot');
  panel.setAttribute('aria-modal', 'false');
  panel.hidden = true;

  // Panel header with title and close button
  const header = document.createElement('div');
  header.className = 'copilot-float-header';
  header.innerHTML = `
    <span class="copilot-float-title">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
      </svg>
      AI Copilot
    </span>
    <button class="copilot-float-close icon-button" id="copilot-float-close" type="button" aria-label="Close AI Copilot">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>
  `;

  // Content mount — renderCopilotShell / renderNoKeyState write into this
  const contentMount = document.createElement('div');
  contentMount.id = 'copilot-float-content';
  contentMount.className = 'copilot-float-content';

  panel.appendChild(header);
  panel.appendChild(contentMount);

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  // ── Restore persisted drawer width ─────────────────────────────────────
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 700;
  const storedWidth = loadDrawerWidth();
  if (storedWidth !== null) {
    panel.style.width = `${storedWidth}px`;
  }

  // ── Resize handle (left edge of drawer) ────────────────────────────────
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'copilot-resize-handle';
  resizeHandle.setAttribute('aria-hidden', 'true');
  panel.appendChild(resizeHandle);

  let isResizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  resizeHandle.addEventListener('pointerdown', (e) => {
    // Disable resize on mobile — the panel is full-width there
    if (window.innerWidth <= 600) return;
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartWidth = panel.offsetWidth;
    resizeHandle.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
    panel.style.transition = 'none'; // suspend slide animation during drag
  });

  resizeHandle.addEventListener('pointermove', (e) => {
    if (!isResizing) return;
    // Dragging left increases width, dragging right decreases it
    const delta = resizeStartX - e.clientX;
    const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeStartWidth + delta));
    panel.style.width = `${newWidth}px`;
  });

  resizeHandle.addEventListener('pointerup', (e) => {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.userSelect = '';
    panel.style.transition = ''; // restore CSS transition
    const finalWidth = panel.offsetWidth;
    saveDrawerWidth(finalWidth);
  });

  // Cancel resize if pointer leaves the window
  resizeHandle.addEventListener('pointercancel', () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.userSelect = '';
    panel.style.transition = '';
  });

  // ── Open / close helpers ────────────────────────────────────────────────
  let initialized = false;

  function openPanel() {
    panel.hidden = false;
    // Small rAF delay so the browser paints hidden=false before adding the
    // open class — this lets the CSS transition actually play.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => panel.classList.add('is-open'));
    });
    fab.setAttribute('aria-expanded', 'true');
    fab.classList.add('is-active');
    saveDrawerOpen(true);

    // Lazy-init the copilot content on first open so we don't do a DB read
    // on every page load — only when the user actually opens the panel.
    if (!initialized) {
      initialized = true;
      loadApiKey().then((apiKey) => {
        if (!apiKey) {
          renderNoKeyState(contentMount, settingsHref);
        } else {
          renderCopilotShell(contentMount);
          bindChat(apiKey);
        }
      });
    }
  }

  function closePanel() {
    panel.classList.remove('is-open');
    fab.setAttribute('aria-expanded', 'false');
    fab.classList.remove('is-active');
    saveDrawerOpen(false);
    // Hide after the CSS transition finishes (300ms > 280ms CSS duration)
    setTimeout(() => { panel.hidden = true; }, 300);
  }

  fab.addEventListener('click', () => {
    if (panel.hidden || !panel.classList.contains('is-open')) openPanel();
    else closePanel();
  });

  document.getElementById('copilot-float-close')?.addEventListener('click', closePanel);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden && panel.classList.contains('is-open')) {
      closePanel();
      fab.focus();
    }
  });

  // ── Auto-restore open state from last session ───────────────────────────
  // Check after a short delay so the page content has finished its own
  // entrance animations before the drawer slides in.
  if (loadDrawerOpen()) {
    setTimeout(() => openPanel(), 800);
  }
}
