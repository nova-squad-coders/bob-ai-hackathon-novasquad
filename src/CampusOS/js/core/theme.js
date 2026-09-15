/**
 * theme.js — light/dark theme, applied via a `data-theme` attribute on
 * <html> so css/tokens.css can swap CSS custom properties in one place.
 *
 * The preference itself is a UI setting, not application data, so it's
 * kept in localStorage rather than IndexedDB — it doesn't need to travel
 * with an export/import of the student's actual records.
 */

const STORAGE_KEY = 'campusos:theme';

function systemPrefersDark() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getTheme() {
  return localStorage.getItem(STORAGE_KEY) || (systemPrefersDark() ? 'dark' : 'light');
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initTheme() {
  applyTheme(getTheme());
  // Follow system changes only if the user has never explicitly chosen.
  if (!localStorage.getItem(STORAGE_KEY) && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(STORAGE_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    });
  }
}
