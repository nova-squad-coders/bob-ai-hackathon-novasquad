/**
 * modal.js — one generic modal + form builder every module reuses so we
 * don't hand-roll dialog markup per module (spec Instruction 5/12: no
 * alert()/prompt() as the interface).
 *
 * Field types supported: text, textarea, number, date, select, checkbox,
 * tags (comma-separated chips), file.
 */

import { el, escapeHTML, generateId } from './utils.js?v=5';

let overlay = null;
let openToken = 0;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeModal();
  });
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * THE BUG THIS FIXES: closeModal() used to always clear the overlay's
 * content 180ms later (after the fade-out finishes), unconditionally.
 * But several flows in this app close one modal and immediately open a
 * new one on top of it (e.g. "+ Add custom category" while filling out
 * a task). If a new modal opened before that old 180ms timer fired, the
 * timer would still wipe the *new* modal's content — while the overlay's
 * `is-open` class stayed applied (added by the new open call). The
 * result: an invisible, full-viewport, `pointer-events: auto` overlay
 * silently swallowing every click on the page, with no console error,
 * because nothing ever threw. `openToken` fixes this: every open() call
 * bumps it, and a scheduled clear only runs if no newer modal has opened
 * since it was scheduled.
 */
export function closeModal() {
  if (!overlay) return;
  overlay.classList.remove('is-open');
  const tokenAtClose = openToken;
  setTimeout(() => {
    if (openToken === tokenAtClose) overlay.innerHTML = '';
  }, 180);
}

function fieldMarkup(field, value) {
  const id = `f_${field.name}`;
  const val = value ?? field.default ?? '';
  if (field.type === 'textarea') {
    return `<textarea id="${id}" name="${field.name}" rows="${field.rows || 3}" placeholder="${escapeHTML(field.placeholder || '')}">${escapeHTML(val)}</textarea>`;
  }
  if (field.type === 'select') {
    const opts = field.options.map((o) => {
      const optVal = typeof o === 'object' ? o.value : o;
      const optLabel = typeof o === 'object' ? o.label : o;
      return `<option value="${escapeHTML(optVal)}" ${String(optVal) === String(val) ? 'selected' : ''}>${escapeHTML(optLabel)}</option>`;
    }).join('');
    return `<select id="${id}" name="${field.name}">${opts}</select>`;
  }
  if (field.type === 'checkbox') {
    return `<label style="display:flex;align-items:center;gap:8px;font-weight:400;">
      <input type="checkbox" id="${id}" name="${field.name}" ${val ? 'checked' : ''} style="width:auto;" />
      <span>${escapeHTML(field.checkboxLabel || '')}</span>
    </label>`;
  }
  if (field.type === 'file') {
    return `<input type="file" id="${id}" name="${field.name}" accept="${field.accept || ''}" />`;
  }
  return `<input type="${field.type || 'text'}" id="${id}" name="${field.name}"
    value="${escapeHTML(val)}" placeholder="${escapeHTML(field.placeholder || '')}"
    ${field.min !== undefined ? `min="${field.min}"` : ''}
    ${field.max !== undefined ? `max="${field.max}"` : ''}
    ${field.step !== undefined ? `step="${field.step}"` : ''}
    ${field.required ? 'required' : ''} />`;
}

/**
 * @param {Object} opts
 * @param {string} opts.title
 * @param {Array}  opts.fields - [{name,label,type,options,required,...}]
 * @param {Object} [opts.values] - existing values, keyed by field name
 * @param {string} [opts.submitLabel]
 * @param {Function} opts.onSubmit - (data) => void | Promise
 * @param {Function} [opts.onDelete] - shown as a destructive left-aligned button if provided
 * @param {string} [opts.extraHTML] - raw HTML injected above the field list (e.g. a repayment history table)
 */
export function openFormModal({ title, fields, values = {}, submitLabel = 'Save', onSubmit, onDelete, extraHTML = '' }) {
  const root = ensureOverlay();
  openToken++;
  const formId = `form_${generateId()}`;

  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${formId}_title">
      <h2 class="modal__title" id="${formId}_title">${escapeHTML(title)}</h2>
      ${extraHTML}
      <form id="${formId}">
        ${fields.map((f) => `
          <div class="field">
            <label for="f_${f.name}">${escapeHTML(f.label)}</label>
            ${fieldMarkup(f, values[f.name])}
          </div>
        `).join('')}
        <div class="modal__actions" style="justify-content:${onDelete ? 'space-between' : 'flex-end'}">
          ${onDelete ? '<button type="button" class="btn btn--ghost" id="modal-delete-btn" style="color:var(--danger);">Delete</button>' : ''}
          <div style="display:flex;gap:12px;">
            <button type="button" class="btn btn--ghost" id="modal-cancel-btn">Cancel</button>
            <button type="submit" class="btn btn--primary">${escapeHTML(submitLabel)}</button>
          </div>
        </div>
      </form>
    </div>
  `;

  requestAnimationFrame(() => root.classList.add('is-open'));

  const form = document.getElementById(formId);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    for (const f of fields) {
      const input = form.elements[f.name];
      if (!input) continue;
      if (f.type === 'checkbox') data[f.name] = input.checked;
      else if (f.type === 'file') data[f.name] = input.files[0] || null;
      else if (f.type === 'number') data[f.name] = input.value === '' ? null : Number(input.value);
      else data[f.name] = input.value;
    }
    await onSubmit(data, form);
  });

  document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
  if (onDelete) {
    document.getElementById('modal-delete-btn').addEventListener('click', () => onDelete());
  }

  const firstInput = form.querySelector('input, select, textarea');
  if (firstInput) firstInput.focus();
}

/** A dialog with an arbitrary set of action buttons (not just
 * confirm/cancel) — used for things like the birthday reminder, where
 * "Mark as wished", "Remind me later", and "Dismiss" are all valid,
 * non-destructive choices. */
export function openActionModal({ title, body, actions }) {
  const root = ensureOverlay();
  openToken++;
  root.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" style="max-width:420px;">
      <h2 class="modal__title">${escapeHTML(title)}</h2>
      ${body ? `<p style="color:var(--ink-soft);font-size:var(--text-sm);line-height:var(--leading-relaxed);margin-bottom:var(--space-2);">${escapeHTML(body)}</p>` : ''}
      <div class="modal__actions" style="flex-wrap:wrap;justify-content:flex-end;">
        ${actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'btn--primary' : 'btn--ghost'}" data-action-idx="${i}">${escapeHTML(a.label)}</button>`).join('')}
      </div>
    </div>
  `;
  requestAnimationFrame(() => root.classList.add('is-open'));
  root.querySelectorAll('[data-action-idx]').forEach((btn) => {
    btn.addEventListener('click', () => actions[Number(btn.dataset.actionIdx)].onClick?.());
  });
}

/** A lighter confirmation dialog for destructive actions (reset all data,
 * delete, settle debt, ...) — still not a native confirm(). */
export function openConfirmModal({ title, body, confirmLabel = 'Confirm', danger = true, onConfirm }) {
  const root = ensureOverlay();
  openToken++;
  root.innerHTML = `
    <div class="modal" role="alertdialog" aria-modal="true" style="max-width:400px;">
      <h2 class="modal__title">${escapeHTML(title)}</h2>
      <p style="color:var(--ink-soft);font-size:var(--text-sm);line-height:var(--leading-relaxed);">${escapeHTML(body)}</p>
      <div class="modal__actions">
        <button type="button" class="btn btn--ghost" id="confirm-cancel-btn">Cancel</button>
        <button type="button" class="btn btn--primary" id="confirm-ok-btn" style="${danger ? 'background:var(--danger);color:#fff;' : ''}">${escapeHTML(confirmLabel)}</button>
      </div>
    </div>
  `;
  requestAnimationFrame(() => root.classList.add('is-open'));
  document.getElementById('confirm-cancel-btn').addEventListener('click', closeModal);
  document.getElementById('confirm-ok-btn').addEventListener('click', async () => {
    await onConfirm();
  });
}
