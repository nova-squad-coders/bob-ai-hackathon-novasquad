/**
 * birthdayCheck.js — runs once per page load (via bootstrap) and looks
 * for any contact whose birthday is today, or coming up in a few days.
 * The day-of check is an in-app action dialog (Mark as wished / Remind
 * me later / Dismiss) — native Notifications can't have action buttons
 * without a service worker, which this local-first app doesn't run, so
 * a real dialog stands in for that. The advance check (3 days out) is a
 * lighter one-line toast, just enough notice to plan something.
 *
 * State is kept in localStorage (not IndexedDB) since it's transient UI
 * state ("have I already asked about this today"), not app data:
 *   campusos:birthday:<personId>:<year>       → 'wished' | isoTimestamp (snooze-until)
 *   campusos:birthday-upcoming:<personId>:<year> → '1' (advance notice already shown)
 */

import { getAll } from './db.js?v=5';
import { CONFIG } from './config.js?v=5';
import { openActionModal, closeModal } from './modal.js?v=5';
import { toast } from './notifications.js?v=5';
import { daysBetween } from './utils.js?v=5';

const ADVANCE_NOTICE_DAYS = 3;

function storageKey(personId, year) {
  return `campusos:birthday:${personId}:${year}`;
}

function upcomingKey(personId, year) {
  return `campusos:birthday-upcoming:${personId}:${year}`;
}

/** Days until this person's next birthday (0 = today), ignoring the
 * birth year entirely — handles the December→January wraparound. */
function daysUntilNextBirthday(person, today) {
  if (!person.birthday) return null;
  const b = new Date(person.birthday);
  let next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
  if (daysBetween(today, next) < 0) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
  return daysBetween(today, next);
}

export async function checkBirthdaysToday() {
  let people;
  try {
    people = await getAll(CONFIG.stores.people.name);
  } catch {
    return;
  }

  const today = new Date();
  const year = today.getFullYear();

  const dueToday = people.filter((p) => {
    if (daysUntilNextBirthday(p, today) !== 0) return false;
    const stored = localStorage.getItem(storageKey(p.id, year));
    if (!stored) return true;
    if (stored === 'wished') return false;
    return new Date(stored) <= new Date();
  });

  const upcoming = people.filter((p) => {
    const days = daysUntilNextBirthday(p, today);
    if (days !== ADVANCE_NOTICE_DAYS) return false;
    return !localStorage.getItem(upcomingKey(p.id, year));
  });

  for (const p of upcoming) {
    toast(`🎂 ${p.name}'s birthday is in ${ADVANCE_NOTICE_DAYS} days — plan ahead.`, 'info', 6000);
    localStorage.setItem(upcomingKey(p.id, year), '1');
  }

  if (dueToday.length) showBirthdayPrompt(dueToday[0], dueToday.slice(1));
}

function showBirthdayPrompt(person, remainingQueue) {
  const year = new Date().getFullYear();
  openActionModal({
    title: `🎂 It's ${person.name}'s birthday today!`,
    body: 'Have you wished them yet?',
    actions: [
      {
        label: 'Mark as wished', primary: true,
        onClick: () => {
          localStorage.setItem(storageKey(person.id, year), 'wished');
          closeModal();
          toast(`Nice — marked ${person.name} as wished.`, 'success');
          advance(remainingQueue);
        },
      },
      {
        label: 'Remind me later',
        onClick: () => {
          const snoozeUntil = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3 hours
          localStorage.setItem(storageKey(person.id, year), snoozeUntil.toISOString());
          closeModal();
          advance(remainingQueue);
        },
      },
      {
        label: 'Dismiss',
        onClick: () => {
          closeModal();
          advance(remainingQueue);
        },
      },
    ],
  });
}

function advance(remainingQueue) {
  if (!remainingQueue.length) return;
  setTimeout(() => showBirthdayPrompt(remainingQueue[0], remainingQueue.slice(1)), 400);
}

// Re-check when the tab regains focus/visibility, and every so often
// while it stays open — mainly to catch the date rolling over past
// midnight in a tab that's been left open, since checkBirthdaysToday()
// otherwise only runs once, at page load.
let recheckStarted = false;
export function startBirthdayRecheck() {
  if (recheckStarted) return;
  recheckStarted = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBirthdaysToday(); });
  window.addEventListener('focus', checkBirthdaysToday);
  setInterval(checkBirthdaysToday, 5 * 60 * 1000);
}
