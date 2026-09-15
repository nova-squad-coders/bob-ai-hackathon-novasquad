/**
 * settings.js — Settings / Data Management (Instructions 31–32).
 */

import { CONFIG } from '../core/config.js?v=5';
import { clearStore } from '../core/db.js?v=5';
import { getTheme, setTheme } from '../core/theme.js?v=5';
import { requestNotificationPermission, canNotify, toast } from '../core/notifications.js?v=5';
import { openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { exportData, downloadExport, importData } from '../core/exportImport.js?v=5';

export async function initSettings() {
  renderThemeControls();
  await renderNotificationControls();
  bindDataManagement();
  renderAbout();
}

function renderThemeControls() {
  const buttons = document.querySelectorAll('[data-theme-choice]');
  const current = getTheme();
  buttons.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.themeChoice === current);
    btn.addEventListener('click', () => {
      setTheme(btn.dataset.themeChoice);
      buttons.forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });
}

async function renderNotificationControls() {
  const statusEl = document.getElementById('notif-status');
  const btn = document.getElementById('notif-enable-btn');

  const update = () => {
    const supported = 'Notification' in window;
    if (!supported) { statusEl.textContent = 'Not supported in this browser.'; btn.hidden = true; return; }
    if (canNotify()) { statusEl.textContent = 'Enabled — you\u2019ll get reminders for tasks and birthdays.'; btn.hidden = true; }
    else if (Notification.permission === 'denied') { statusEl.textContent = 'Blocked — enable notifications for this site in your browser settings if you want them.'; btn.hidden = true; }
    else { statusEl.textContent = 'Not enabled yet. CampusOS works fine without this — reminders will show as in-app messages instead.'; btn.hidden = false; }
  };

  btn.addEventListener('click', async () => {
    await requestNotificationPermission();
    update();
  });
  update();
}

function bindDataManagement() {
  document.getElementById('export-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Preparing…';
    try {
      const payload = await exportData();
      await downloadExport(payload);
      toast('Backup downloaded.', 'success');
    } catch (err) {
      console.error('Export failed:', err);
      toast(`Export failed: ${err?.message || 'something went wrong reading your data.'}`, 'error', 7000);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  document.getElementById('import-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const summary = await importData(payload);
      const counts = Object.entries(summary.imported).map(([k, v]) => `${v} ${k}`).join(', ');
      toast(`Import complete: ${counts || 'nothing new'}.`, 'success', 6000);
      if (summary.errors.length) toast(`Some data couldn't be imported: ${summary.errors.join('; ')}`, 'error', 8000);
    } catch (err) {
      toast(`Import failed: ${err.message || 'the file could not be read.'}`, 'error', 7000);
    }
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    openConfirmModal({
      title: 'Reset all CampusOS data?',
      body: 'This permanently deletes every task, transaction, contact, result, library item, achievement, attendance record, and your resume profile from this browser. This cannot be undone — export a backup first if you\u2019re not sure.',
      confirmLabel: 'Delete everything',
      onConfirm: async () => {
        for (const store of Object.values(CONFIG.stores)) {
          await clearStore(store.name);
        }
        closeModal();
        toast('All CampusOS data has been reset.', 'success');
      },
    });
  });
}

function renderAbout() {
  document.getElementById('about-note').textContent =
    `${CONFIG.productName} stores everything locally in this browser's IndexedDB. Nothing is uploaded anywhere — clearing your browser data or switching devices means starting fresh unless you've exported a backup.`;
}

