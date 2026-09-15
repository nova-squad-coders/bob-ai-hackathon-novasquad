/**
 * validators.js — small, reusable checks so "is this phone number
 * plausible" or "is this date in the future" isn't reimplemented (or
 * skipped) per module.
 */

/** Strict Indian mobile format: exactly 10 digits, first digit 6–9.
 * Returns null when valid, or an error string to show the user. */
export function validatePhone(value, { required = false } = {}) {
  const trimmed = (value || '').trim();
  if (!trimmed) return required ? 'Enter a phone number.' : null;
  const digitsOnly = /^\d+$/.test(trimmed);
  if (!digitsOnly) return 'Phone number should contain digits only.';
  if (trimmed.length !== 10) return 'Phone number should be exactly 10 digits.';
  if (!/^[6-9]/.test(trimmed)) return 'Phone number should start with 6, 7, 8, or 9.';
  return null;
}

export function validateEmail(value, { required = false } = {}) {
  const trimmed = (value || '').trim();
  if (!trimmed) return required ? 'Enter an email address.' : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Enter a valid email address.';
  return null;
}

/** Rejects a date that is today or in the future — for things that must
 * have already happened (a birthday, an achievement date, a completed
 * result). Returns null when valid. */
export function validateNotTodayOrFuture(value, label = 'Date') {
  if (!value) return null;
  const d = new Date(value);
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  if (d >= today) return `${label} can't be today or in the future.`;
  return null;
}

export function validateNotFuture(value, label = 'Date') {
  if (!value) return null;
  const d = new Date(value);
  const today = new Date();
  d.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  if (d > today) return `${label} can't be in the future.`;
  return null;
}
