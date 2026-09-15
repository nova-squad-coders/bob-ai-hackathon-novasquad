/**
 * navigation.js — renders the sidebar/topbar shell from CONFIG.modules so
 * that adding a real module later means flipping `status` to 'active' in
 * config.js, not editing markup on every page (spec Instruction 43/44).
 */

import { CONFIG } from './config.js?v=5';
import { toggleTheme, getTheme } from './theme.js?v=5';
import { el } from './utils.js?v=5';

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  'check-square': '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="16.5" cy="14" r="1.2"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><path d="M16 4.6c1.8.5 3 2.1 3 4s-1.2 3.5-3 4"/><path d="M19.5 14.2c2 .7 3.2 2.6 3.2 5"/>',
  'trending-up': '<path d="M3 17l6-6.5 4 4L21 6"/><path d="M15 6h6v6"/>',
  'book-open': '<path d="M12 6.5c-2-1.7-5-2.2-9-1.5v14c4-.7 7-.2 9 1.5 2-1.7 5-2.2 9-1.5V5c-4-.7-7-.2-9 1.5z"/><path d="M12 6.5V21"/>',
  award: '<circle cx="12" cy="8.5" r="5.5"/><path d="M8.2 13.2L6.5 21l5.5-3 5.5 3-1.7-7.8"/>',
  'calendar-check': '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/><path d="M8 3v3M16 3v3"/><path d="M8.5 14.5l2 2 4.5-4.5"/>',
  'file-text': '<path d="M6 2.5h8l5 5V21a1 1 0 01-1 1H6a1 1 0 01-1-1V3.5a1 1 0 011-1z"/><path d="M14 2.5V8h5"/><path d="M8.5 13h7M8.5 16.5h7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.87-.34 1.7 1.7 0 00-1.04 1.56V21a2 2 0 11-4 0v-.09A1.7 1.7 0 009 19.36a1.7 1.7 0 00-1.87.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.7 1.7 0 004.64 15 1.7 1.7 0 003.08 14H3a2 2 0 110-4h.09A1.7 1.7 0 004.64 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.64c.55-.24 1.04-.79 1.04-1.56V3a2 2 0 114 0v.09c0 .77.49 1.32 1.04 1.56.6.26 1.31.15 1.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06c-.49.56-.6 1.27-.34 1.87.24.55.79 1.04 1.56 1.04H21a2 2 0 110 4h-.09c-.77 0-1.32.49-1.56 1.04z"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 119.5 4a7 7 0 0010.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12H5M19 12h2.5M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>',
  sparkle: '<path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>',
};

function icon(name, extraClass = '') {
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

export { icon, ICONS };

/** activeId: the module id of the current page, e.g. 'dashboard' or 'tasks' */
export function renderNavigation(activeId) {
  applySidebarCollapsed(isSidebarCollapsed());
  renderSidebar(activeId);
  renderTopbar();
}

/** Pages live either at the project root (index.html) or one level down
 * in pages/. Module hrefs in config.js are always written root-relative
 * (e.g. 'pages/tasks.html'), so we prefix with '../' when the current
 * document is itself inside pages/. */
function pathPrefix() {
  return window.location.pathname.includes('/pages/') ? '../' : '';
}

function renderSidebar(activeId) {
  const mount = document.getElementById('app-sidebar');
  if (!mount) return;

  const prefix = pathPrefix();
  const items = CONFIG.modules.map((mod) => {
    const isActive = mod.id === activeId;
    const isPlanned = mod.status === 'planned';
    const classes = ['nav-item'];
    if (isActive) classes.push('nav-item--active');
    if (isPlanned) classes.push('nav-item--planned');
    const label = isPlanned ? `${mod.label}` : mod.label;
    const badge = isPlanned ? '<span class="nav-item__badge">soon</span>' : '';
    const tag = isPlanned ? 'div' : 'a';
    const href = isPlanned ? '' : `href="${prefix}${mod.href}"`;
    return `<${tag} class="${classes.join(' ')}" ${href} ${isPlanned ? 'aria-disabled="true" tabindex="-1"' : ''} title="${isPlanned ? mod.label + ' — coming soon' : mod.label}">
        ${icon(mod.icon, 'nav-item__icon')}
        <span class="nav-item__label">${label}</span>
        ${badge}
      </${tag}>`;
  }).join('');

  mount.innerHTML = `
    <a class="sidebar__brand" href="${prefix}index.html">
      <span class="sidebar__mark" aria-hidden="true">C</span>
      <span class="sidebar__name">CampusOS</span>
    </a>
    <nav class="sidebar__nav" aria-label="Primary">${items}</nav>
    <div class="sidebar__foot">
      <p class="sidebar__hint">Local-first. Your data stays on this device.</p>
    </div>
  `;
}

function renderTopbar() {
  const mount = document.getElementById('app-topbar');
  if (!mount) return;

  mount.innerHTML = `
    <button type="button" id="sidebar-toggle" class="icon-button" aria-label="Toggle sidebar">
      ${icon('panel-left')}
    </button>
    <div class="topbar__search">
      ${icon('search', 'topbar__search-icon')}
      <input type="search" id="global-search-input" class="topbar__search-input"
        placeholder="Search tasks, people, library, achievements…" aria-label="Global search" />
    </div>
    <button type="button" id="theme-toggle" class="icon-button" aria-label="Toggle theme">
      ${icon(getTheme() === 'dark' ? 'sun' : 'moon')}
    </button>
  `;

  const themeBtn = document.getElementById('theme-toggle');
  themeBtn.addEventListener('click', () => {
    const next = toggleTheme();
    themeBtn.innerHTML = icon(next === 'dark' ? 'sun' : 'moon');
  });

  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebarCollapsed);
}

const SIDEBAR_COLLAPSE_KEY = 'campusos:sidebarCollapsed';
const MOBILE_QUERY = '(max-width: 900px)';

function isMobile() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function isSidebarCollapsed() {
  return localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === '1';
}

function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
}

function ensureMobileBackdrop() {
  let backdrop = document.getElementById('mobile-nav-backdrop');
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.id = 'mobile-nav-backdrop';
  backdrop.className = 'mobile-nav-backdrop';
  backdrop.addEventListener('click', closeMobileNav);
  document.body.appendChild(backdrop);
  return backdrop;
}

function openMobileNav() {
  const sidebar = document.getElementById('app-sidebar');
  if (!sidebar) return;
  sidebar.classList.add('is-open');
  ensureMobileBackdrop().classList.add('is-visible');
}

function closeMobileNav() {
  const sidebar = document.getElementById('app-sidebar');
  if (sidebar) sidebar.classList.remove('is-open');
  const backdrop = document.getElementById('mobile-nav-backdrop');
  if (backdrop) backdrop.classList.remove('is-visible');
}

/** On desktop this collapses the sidebar to an icon-only rail (persisted
 * across visits). On mobile — where the sidebar is off-canvas by default
 * — the same button instead slides it into view with a backdrop, since
 * "collapsed" has no meaning when it's already hidden. */
function toggleSidebarCollapsed() {
  if (isMobile()) {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar?.classList.contains('is-open')) closeMobileNav();
    else openMobileNav();
    return;
  }
  const next = !isSidebarCollapsed();
  localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? '1' : '0');
  applySidebarCollapsed(next);
}

export { el };
