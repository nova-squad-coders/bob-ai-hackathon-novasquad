/**
 * notifications.js — two distinct things live here on purpose:
 *
 * 1. Toasts: in-app feedback ("Task saved", "Import failed: ..."). This is
 *    the app's primary feedback mechanism — spec Instruction 38/Note 12
 *    rule out alert()/prompt() as the interface, so every module should
 *    call `toast()` instead of alert() for confirmations and errors.
 *
 * 2. Browser notifications: an optional, permission-gated layer for task
 *    reminders / birthdays (Instruction 6, 34). The app must stay fully
 *    functional if the user denies or never grants permission — every
 *    call here is wrapped so a denial never throws upstream.
 */

let toastRoot = null;

function ensureToastRoot() {
  if (toastRoot) return toastRoot;
  toastRoot = document.createElement('div');
  toastRoot.className = 'toast-stack';
  toastRoot.setAttribute('role', 'status');
  toastRoot.setAttribute('aria-live', 'polite');
  document.body.appendChild(toastRoot);
  return toastRoot;
}

/** type: 'success' | 'error' | 'info' */
export function toast(message, type = 'info', duration = 4000) {
  const root = ensureToastRoot();
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  node.textContent = message;
  root.appendChild(node);

  requestAnimationFrame(() => node.classList.add('toast--visible'));

  const remove = () => {
    node.classList.remove('toast--visible');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
  };
  const timer = setTimeout(remove, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

/** Only ask when the user has done something that implies they want a
 * reminder (e.g. toggled "remind me" on a task) — never on page load. */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function canNotify() {
  return 'Notification' in window && Notification.permission === 'granted';
}

/** Fire a native notification if permitted; otherwise fall back to an
 * in-app toast so the reminder still reaches the student. */
export function notify(title, options = {}) {
  if (canNotify()) {
    try {
      // eslint-disable-next-line no-new
      new Notification(title, options);
      return;
    } catch {
      // fall through to toast
    }
  }
  toast(options.body ? `${title} — ${options.body}` : title, 'info', 6000);
}
