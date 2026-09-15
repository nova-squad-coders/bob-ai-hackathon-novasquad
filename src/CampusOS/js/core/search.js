/**
 * search.js — global search (Instruction 33). Each entry in
 * SEARCH_PROVIDERS knows how to pull matching records out of one store
 * and describe them generically; adding a future module's search support
 * means adding one entry here, not touching the search UI.
 *
 * Selecting a result navigates to that module with `?open=<id>` in the
 * URL; each module's init() checks for that param and opens the matching
 * item's detail/edit modal once its own data has loaded.
 */

import { CONFIG } from './config.js?v=5';
import { getAll } from './db.js?v=5';
import { escapeHTML, debounce } from './utils.js?v=5';

const S = CONFIG.stores;

const SEARCH_PROVIDERS = [
  {
    moduleId: 'tasks', label: 'Tasks', href: 'pages/tasks.html', store: S.tasks.name,
    match: (q, r) => (r.title || '').toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q),
    title: (r) => r.title, subtitle: (r) => r.category || '',
  },
  {
    moduleId: 'spendee', label: 'Spendee', href: 'pages/spendee.html', store: S.transactions.name,
    match: (q, r) => (r.description || '').toLowerCase().includes(q) || (r.category || '').toLowerCase().includes(q),
    title: (r) => r.description || r.category, subtitle: (r) => `₹${r.amount}`,
  },
  {
    moduleId: 'spendee', label: 'Spendee — debts', href: 'pages/spendee.html', store: S.debts.name,
    match: (q, r) => (r.person || '').toLowerCase().includes(q) || (r.notes || '').toLowerCase().includes(q),
    title: (r) => r.person, subtitle: (r) => r.direction === 'owed_to_me' ? 'Owes you' : 'You owe',
  },
  {
    moduleId: 'people', label: 'People', href: 'pages/people.html', store: S.people.name,
    match: (q, r) => [r.name, r.email, r.phone, r.notes].filter(Boolean).some((f) => f.toLowerCase().includes(q)),
    title: (r) => r.name, subtitle: (r) => r.category || '',
  },
  {
    moduleId: 'performance', label: 'Performance', href: 'pages/performance.html', store: S.performance.name,
    match: (q, r) => (r.subject || '').toLowerCase().includes(q) || (r.assessmentType || '').toLowerCase().includes(q),
    title: (r) => `${r.subject} — ${r.assessmentType}`, subtitle: (r) => `${r.obtainedMarks}/${r.maxMarks}`,
  },
  {
    moduleId: 'library', label: 'Library', href: 'pages/library.html', store: S.libraryItems.name,
    match: (q, r) => [r.title, r.subject, r.semester, r.folder, (r.tags || []).join(' ')].filter(Boolean).some((f) => f.toLowerCase().includes(q)),
    title: (r) => r.title, subtitle: (r) => r.subject || '',
  },
  {
    moduleId: 'achievements', label: 'Achievements', href: 'pages/achievements.html', store: S.achievements.name,
    match: (q, r) => [r.title, r.issuer, r.description, (r.tags || []).join(' ')].filter(Boolean).some((f) => f.toLowerCase().includes(q)),
    title: (r) => r.title, subtitle: (r) => r.issuer || '',
  },
];

function pathPrefix() {
  return window.location.pathname.includes('/pages/') ? '../' : '';
}

async function runSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const grouped = [];
  for (const provider of SEARCH_PROVIDERS) {
    let records;
    try { records = await getAll(provider.store); } catch { continue; }
    const matches = records.filter((r) => provider.match(q, r)).slice(0, 5);
    if (matches.length) {
      grouped.push({ provider, results: matches });
    }
  }
  return grouped;
}

let panel = null;

function ensurePanel(anchorInput) {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.className = 'card search-panel';
  panel.style.cssText = `
    position: absolute; top: calc(100% + 8px); left: 0; right: 0;
    max-height: 60vh; overflow-y: auto; z-index: 60; padding: 8px; display: none;
  `;
  anchorInput.parentElement.style.position = 'relative';
  anchorInput.parentElement.appendChild(panel);
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== anchorInput) hidePanel();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePanel(); });
  return panel;
}

function hidePanel() { if (panel) panel.style.display = 'none'; }

export function initGlobalSearch() {
  const input = document.getElementById('global-search-input');
  if (!input) return;
  const p = ensurePanel(input);
  const prefix = pathPrefix();

  const handler = debounce(async (e) => {
    const grouped = await runSearch(e.target.value);
    if (!grouped.length) {
      p.innerHTML = e.target.value.trim()
        ? `<div style="padding:var(--space-4);font-size:var(--text-sm);color:var(--ink-faint);">No results for "${escapeHTML(e.target.value.trim())}".</div>`
        : '';
      p.style.display = e.target.value.trim() ? 'block' : 'none';
      return;
    }
    p.innerHTML = grouped.map((g) => `
      <div class="section-title" style="margin:8px 8px 4px;">${escapeHTML(g.provider.label)}</div>
      ${g.results.map((r) => `
        <a href="${prefix}${g.provider.href}?open=${r.id}" class="search-result" style="display:block;padding:8px 12px;border-radius:8px;text-decoration:none;color:var(--ink);font-size:var(--text-sm);">
          <div style="font-weight:600;">${escapeHTML(g.provider.title(r) || 'Untitled')}</div>
          ${g.provider.subtitle(r) ? `<div style="font-size:var(--text-xs);color:var(--ink-faint);">${escapeHTML(String(g.provider.subtitle(r)))}</div>` : ''}
        </a>
      `).join('')}
    `).join('');
    p.style.display = 'block';
  }, 200);

  input.addEventListener('input', handler);
  input.addEventListener('focus', () => { if (input.value.trim()) p.style.display = 'block'; });
}

/** Reads ?open=<id> from the current URL — module pages call this after
 * their own data has loaded to jump straight to a search result. */
export function getDeepLinkId() {
  return new URLSearchParams(window.location.search).get('open');
}
