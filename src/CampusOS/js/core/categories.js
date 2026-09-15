/**
 * categories.js — every module that lets students define custom
 * categories (Tasks, Spendee, People, Achievements — spec Instructions
 * 5, 8, 11, 20) shares this instead of reimplementing "seed defaults
 * once, then let the user add more" four times.
 */

import { getAll, create } from './db.js?v=5';

/** Ensures a category store has its default seed values, then returns
 * every category currently in it. Idempotent — safe to call on every
 * page load. */
export async function ensureCategories(storeName, defaults) {
  const existing = await getAll(storeName);
  if (existing.length > 0) return existing;
  const created = [];
  for (const name of defaults) {
    created.push(await create(storeName, { name }));
  }
  return created;
}

export async function addCategory(storeName, name) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Category name cannot be empty.');
  const existing = await getAll(storeName);
  if (existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    return existing.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  }
  return create(storeName, { name: trimmed });
}
