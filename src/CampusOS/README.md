# 🎓 CampusOS

**One place for everything college.** Tasks, money, people, grades, study
material, achievements, attendance, and a resume builder — all local to
your browser, no account, no server, no paid APIs.

> 📛 Working name — may get renamed later (see `Note 1` in the product
> spec this was built from).

---

## ✨ What's inside

| Module | What it does |
|---|---|
| 🧭 **Dashboard** | A live command center — today's tasks, spending, grades, and more, pulled from every other module |
| ✅ **Tasks** | Assignments, exams, deadlines — with due-date reminders and custom categories |
| 💸 **Spendee** | Income & expenses with charts, color-coded categories, monthly budgets, recurring transactions, and a real debt tracker (partial repayments included) |
| 👥 **People** | A contact book for professors, classmates, and friends — with birthday reminders |
| 📈 **Performance** | Track test/exam scores by subject, set goals, and try "what if I score X next time?" |
| 📚 **Digital Library** | Notes, PDFs, links, and typed notes — organized by subject and semester, searchable |
| 🏆 **Achievements** | A vault for every certificate and win, even the small ones, so nothing gets forgotten by resume time |
| 🗓️ **Attendance** | Configure your own subjects and requirements — get real "can I skip the next class?" math |
| 📄 **Resume Builder** | Build a profile gradually, pull achievements straight from your vault, export a real downloadable PDF |
| ⚙️ **Settings** | Theme, notifications, full data export/import, and a reset button |

Everything talks to a shared local database (IndexedDB) — nothing is ever
sent anywhere. 🔒

---

## 🗂️ Project structure

```
CampusOS/
├── index.html            # Dashboard — the app's entry point
├── pages/                # One HTML page per module
├── css/
│   ├── tokens.css         # Colors, type, spacing, motion — light + dark
│   ├── base.css           # Reset, typography, the app shell (sidebar/topbar)
│   ├── components.css     # Cards, buttons, badges, modals, toasts
│   ├── page.css           # Shared list/toolbar/tab layout used by most modules
│   ├── dashboard.css      # Dashboard-only layout
│   └── resume.css         # The printable/exportable resume document
├── js/
│   ├── core/               # Shared infrastructure — see below 👇
│   └── <module>/           # One folder per module (tasks, spendee, ...)
└── assets/
```

### 🧱 The storage rule

**No module talks to IndexedDB directly.** Everything goes through
`js/core/db.js` (`create`, `getAll`, `update`, `remove`, `queryByIndex`,
...) against store names declared once in `js/core/config.js`. That's the
seam a future cloud-sync layer could slot into without touching every
module.

Every record gets a stable `id` and `createdAt`/`updatedAt` timestamps,
stamped automatically.

### 🧩 Adding a new module

1. Add its store(s) to `CONFIG.stores` in `js/core/config.js`. If you're
   changing the schema after this has already been used once, **bump
   `CONFIG.db.version`** — IndexedDB only creates new stores during a
   version upgrade, so forgetting this step is a classic way to silently
   break every button on a page that depends on the new store.
2. Flip its entry in `CONFIG.modules` from `'planned'` to `'active'` —
   the sidebar updates itself.
3. Create `pages/<module>.html` + `js/<module>/<module>.js` +
   `js/<module>/index.js`. Call `bootstrap('<id>')` from the entry script
   the same way every other module does.
4. If it should show up on the Dashboard, add a widget in
   `js/dashboard/dashboard.js` that reads the new store — and shows a
   real empty state when there's no data, never a fake zero-filled chart.

### 🎨 Design system

`css/tokens.css` is the single source of truth for colors, type, spacing,
and motion — an ink-blue base with a warm amber accent, Space Grotesk for
headings, Inter for body text. Light and dark themes share the same
variable names, swapped via `[data-theme]` on `<html>`.

### 🧠 Core principles

- **Usefulness > maintainability > correctness > UX > visual polish >
  feature count.**
- No `alert()` / `prompt()` — in-app modals and toasts only.
- No fake data, ever. An empty widget says so; it doesn't fabricate a
  chart.
- No paid APIs, no backend, no login. Local-first and honest about the
  tradeoffs that come with that (see below 👇).

---

## ⚠️ Known limits (by design, not bugs)

- **Notifications only work while a CampusOS tab is open somewhere**
  (even backgrounded). If the browser is fully closed or a mobile OS
  suspends it, nothing can fire until it's reopened — that needs a
  server-side push service, which is out of scope for a backend-free app.
- **Export/Import** is a real, complete backup (it embeds library files
  and certificates as base64, not just structured data) — but it can get
  large with a full library. On mobile it uses the native share sheet
  instead of a direct download link, since mobile browsers don't reliably
  support downloading blob URLs the classic way.
- **Resume PDF export** renders the actual resume as a PDF client-side
  (via html2pdf.js, loaded from a CDN) rather than relying on the
  browser's print dialog — this works consistently on both desktop and
  mobile.

---

## 🛠️ Built incrementally

Development followed a staged plan (foundation → dashboard → each module
→ search → backup → polish) rather than one giant pass — see the product
spec for the full rationale if you're picking this project back up later.

---

## 📄 License

TBD — figuring this out before a public release.
