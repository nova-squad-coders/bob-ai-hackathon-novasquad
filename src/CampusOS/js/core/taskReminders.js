/**
 * taskReminders.js — runs on every page (wired into bootstrap, like
 * birthdayCheck.js) rather than only while the Tasks page itself happens
 * to be open, so a reminder can fire while you're on the Dashboard,
 * Spendee, or anywhere else in the app.
 *
 * Real limitation worth being upfront about: this only runs while some
 * CampusOS tab is open. Browsers — especially on mobile — heavily
 * throttle or fully suspend timers in backgrounded tabs to save battery,
 * so a reminder set for an exact time may not fire at that exact moment
 * if no tab is in the foreground, and if the browser itself is closed or
 * the phone is locked, nothing can run at all. True background
 * notifications need a server that can push to a mostly-dormant device,
 * which is out of scope for a backend-free, local-first app.
 *
 * What this does guarantee: the check is level-triggered (it looks at
 * current time vs. when a reminder was due, not "did the timer fire at
 * the right millisecond"), and it re-runs immediately whenever a
 * CampusOS tab becomes visible or focused — so a reminder that was due
 * while you were away still fires the moment you come back, rather than
 * being silently missed.
 */

import { getAll } from './db.js?v=5';
import { CONFIG } from './config.js?v=5';
import { notify } from './notifications.js?v=5';
import { daysBetween } from './utils.js?v=5';

let started = false;

async function checkOnce() {
  let tasks;
  try {
    tasks = await getAll(CONFIG.stores.tasks.name);
  } catch {
    return;
  }

  const now = new Date();
  for (const t of tasks) {
    if (!t.reminderEnabled || t.status === 'completed' || !t.dueDate) continue;

    const due = new Date(t.dueDate);
    const [h, m] = (t.reminderTime || '09:00').split(':').map(Number);
    const reminderMoment = new Date(due.getFullYear(), due.getMonth(), due.getDate() - (t.reminderOffsetDays || 0), h, m);
    if (now < reminderMoment) continue;

    const key = `campusos:reminded:${t.id}:${reminderMoment.toDateString()}`;
    if (localStorage.getItem(key)) continue;

    const daysLeft = daysBetween(now, due);
    const label = daysLeft <= 0 ? 'Due today' : daysLeft === 1 ? 'Due tomorrow' : `Due in ${daysLeft} days`;
    notify(label, { body: t.title });
    localStorage.setItem(key, '1');
  }
}

export function startTaskReminderChecks() {
  checkOnce();
  if (started) return; // avoid stacking multiple intervals/listeners per page
  started = true;
  setInterval(checkOnce, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkOnce(); });
  window.addEventListener('focus', checkOnce);
}
