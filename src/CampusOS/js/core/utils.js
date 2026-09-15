/**
 * utils.js — small, dependency-free helpers used across every module.
 * Nothing here touches IndexedDB or the DOM structure of a specific page.
 */

/** Stable unique id: timestamp component + random component. Sorts roughly
 * chronologically, which is convenient for default list ordering. */
export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Always store/compare dates as ISO strings internally (spec Instruction 3). */
export function nowISO() {
  return new Date().toISOString();
}

export function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString();
}

/** Human display helpers — keep all "pretty" date formatting here so every
 * module renders dates consistently. */
export function formatDate(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: opts.year === false ? undefined : 'numeric',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(iso)}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

export function isSameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

export function daysBetween(fromISO, toISO) {
  const MS_DAY = 1000 * 60 * 60 * 24;
  const from = new Date(fromISO);
  const to = new Date(toISO);
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  return Math.round((to - from) / MS_DAY);
}

export function formatCurrency(amount) {
  const n = Number(amount) || 0;
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

/** Escape user-generated text before it ever touches innerHTML (spec
 * Instruction 41 — never trust stored strings when rendering). */
export function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Deterministic, pleasant color per category name — same category always
 * gets the same color across charts, chips, and legends without needing
 * a stored color field. Uses HSL so lightness/saturation stay controlled
 * regardless of hash value (avoids muddy or neon results). */
export function categoryColor(name) {
  const str = String(name || 'Other');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 62%, 52%)`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Applies the shared rise-in entrance animation to a freshly-rendered
 * list/grid, staggering each child slightly so groups of cards feel like
 * they arrive rather than flash into place all at once. Call right after
 * setting `container.innerHTML`. */
export function staggerChildren(container, selector = ':scope > *') {
  if (!container) return;
  const children = container.querySelectorAll(selector);
  children.forEach((child, i) => {
    child.style.setProperty('--stagger', i);
    child.classList.add('animate-in');
  });
}
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}
