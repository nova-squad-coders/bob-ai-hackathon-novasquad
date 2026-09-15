/**
 * app.js — the one bootstrap sequence every page runs before doing its own
 * thing. Keeps "turn on the lights" logic (theme, db, nav shell, global
 * search wiring) out of individual module files.
 */

import { initTheme } from './theme.js?v=5';
import { renderNavigation } from './navigation.js?v=5';
import { isReady } from './db.js?v=5';
import { toast } from './notifications.js?v=5';
import { CONFIG } from './config.js?v=5';
import { initGlobalSearch } from './search.js?v=5';
import { checkBirthdaysToday, startBirthdayRecheck } from './birthdayCheck.js?v=5';
import { startTaskReminderChecks } from './taskReminders.js?v=5';
import { initCopilotFloat } from '../copilot/copilot.js?v=1';

/**
 * @param {string} activeModuleId - which nav item to highlight, e.g. 'dashboard'
 * @returns {Promise<boolean>} whether storage came up healthy
 */
export async function bootstrap(activeModuleId) {
  initTheme();
  renderNavigation(activeModuleId);
  initGlobalSearch();
  document.title = document.title || CONFIG.productName;

  const status = await isReady();
  if (!status.ok) {
    showStorageErrorBanner(status.message);
  } else {
    checkBirthdaysToday();
    startBirthdayRecheck();
    startTaskReminderChecks();
  }

  // Inject the floating Copilot button + panel on every page.
  // Runs after storage check so the key lookup via getConfigValue is safe.
  initCopilotFloat();

  return status.ok;
}

function showStorageErrorBanner(message) {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: sticky; top: 0; z-index: 200; background: var(--danger); color: #fff;
    padding: 10px 20px; font-size: 13px; display: flex; align-items: center;
    justify-content: center; gap: 16px; text-align: center;
  `;
  banner.innerHTML = `
    <span>⚠️ Couldn't open local storage: ${message} Nothing will be saved until this is fixed.</span>
    <button type="button" style="background:#fff;color:var(--danger);border:none;border-radius:6px;padding:4px 10px;font-weight:700;cursor:pointer;">Reload</button>
  `;
  banner.querySelector('button').addEventListener('click', () => window.location.reload());
  document.body.prepend(banner);
}

/**
 * Runs a page's module-specific init function and never lets it fail
 * silently. Without this, a single thrown error partway through init
 * (e.g. a store that doesn't exist yet) stops execution right there —
 * including every event listener the rest of the function would have
 * attached — so buttons on the page look like they simply don't respond,
 * with no visible sign anything went wrong.
 */
export async function runPage(initFn) {
  try {
    await initFn();
  } catch (err) {
    console.error('CampusOS page failed to initialize:', err);
    toast('Something went wrong loading this page. Try refreshing — if it keeps happening, your browser storage may need a reset from Settings.', 'error', 9000);
  }
}
