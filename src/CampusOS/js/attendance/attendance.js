/**
 * attendance.js — Attendance (Instructions 24–27). Deliberately the most
 * "calculated" module: nothing here assumes one college's formula. Each
 * subject stores its own required percentage, and every projection is
 * derived live from attended/conducted counts — never guessed.
 *
 * Math reference (all percentages as 0–100, `req` = required %):
 *   current %        = attended / conducted * 100
 *   safe-to-skip      = floor( attended*100/req − conducted ), clamped to ≥ 0
 *     (largest k such that attended / (conducted+k) * 100 stays ≥ req)
 *   classes needed     = ceil( (req*conducted − 100*attended) / (100−req) ), clamped to ≥ 0
 *     (smallest m such that (attended+m) / (conducted+m) * 100 reaches req)
 * Both are projections based on today's numbers, not guarantees about a
 * future schedule the app doesn't know (Instruction 26).
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, create, update, remove } from '../core/db.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast } from '../core/notifications.js?v=5';
import { escapeHTML, nowISO } from '../core/utils.js?v=5';

const SUBJ_STORE = CONFIG.stores.attendanceSubjects.name;
const LOG_STORE = CONFIG.stores.attendanceLog.name;

let subjects = [];

export async function initAttendance() {
  await reload();
  document.getElementById('att-add-btn').addEventListener('click', () => openSubjectModal());
}

async function reload() {
  subjects = await getAll(SUBJ_STORE);
  render();
}

function currentPct(s) {
  return s.conducted ? (s.attended / s.conducted) * 100 : null;
}

function safeToSkip(s) {
  if (!s.conducted) return null;
  const raw = (s.attended * 100) / s.requiredPercentage - s.conducted;
  return Math.max(0, Math.floor(raw + 1e-9));
}

function classesNeeded(s) {
  const req = s.requiredPercentage;
  const pct = currentPct(s);
  if (pct !== null && pct >= req) return 0;
  if (req >= 100) return null; // mathematically unreachable if any class has been missed
  const raw = (req * s.conducted - 100 * s.attended) / (100 - req);
  return Math.max(0, Math.ceil(raw - 1e-9));
}

function render() {
  const mount = document.getElementById('att-grid');
  if (!subjects.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);grid-column:1/-1;">
      <span class="empty-state__title">No subjects configured</span>
      <span class="empty-state__body">Add your subjects with their required attendance percentage — every college and department is different, so nothing here is hard-coded.</span>
    </div>`;
    return;
  }

  mount.innerHTML = subjects.map((s) => {
    const pct = currentPct(s);
    const short = pct !== null && pct < s.requiredPercentage;
    const skip = safeToSkip(s);
    const needed = classesNeeded(s);
    return `
      <div class="card" style="padding:var(--space-5);">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);">
          <div>
            <div style="font-weight:600;font-size:var(--text-sm);">${escapeHTML(s.name)}</div>
            <div style="font-size:var(--text-xs);color:var(--ink-faint);">${escapeHTML(s.code || '')}${s.sessionType ? ` · ${escapeHTML(s.sessionType)}` : ''} · needs ${s.requiredPercentage}%</div>
          </div>
          <button class="icon-button" data-edit="${s.id}" aria-label="Edit subject" style="width:32px;height:32px;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
          </button>
        </div>

        <div style="display:flex;align-items:baseline;gap:8px;margin:var(--space-4) 0 var(--space-2);">
          <span style="font-family:var(--font-display);font-size:var(--text-xl);color:${pct === null ? 'var(--ink-faint)' : short ? 'var(--danger)' : 'var(--success)'}">${pct === null ? '—' : pct.toFixed(1) + '%'}</span>
          <span style="font-size:var(--text-xs);color:var(--ink-faint);">${s.attended}/${s.conducted} classes</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct || 0}%;background:${short ? 'var(--danger)' : 'var(--success)'};"></div></div>

        <div style="font-size:var(--text-xs);color:var(--ink-soft);margin-top:var(--space-3);line-height:var(--leading-relaxed);">
          ${skip === null ? 'Mark a class to see projections.' :
            skip > 0 ? `You can safely skip up to <strong>${skip}</strong> upcoming class${skip === 1 ? '' : 'es'} and stay at ${s.requiredPercentage}%.`
            : needed ? `Attend the next <strong>${needed}</strong> class${needed === 1 ? '' : 'es'} to get back to ${s.requiredPercentage}%.`
            : 'Right at the line — attend your next class to stay safe.'}
        </div>

        <div style="display:flex;gap:8px;margin-top:var(--space-4);">
          <button class="btn btn--primary" style="flex:1;justify-content:center;" data-present="${s.id}">Present</button>
          <button class="btn btn--ghost" style="flex:1;justify-content:center;" data-absent="${s.id}">Absent</button>
        </div>
      </div>
    `;
  }).join('');

  mount.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => openSubjectModal(subjects.find((s) => s.id === btn.dataset.edit))));
  mount.querySelectorAll('[data-present]').forEach((btn) => btn.addEventListener('click', () => markClass(btn.dataset.present, true)));
  mount.querySelectorAll('[data-absent]').forEach((btn) => btn.addEventListener('click', () => markClass(btn.dataset.absent, false)));
}

async function markClass(subjectId, present) {
  const s = subjects.find((x) => x.id === subjectId);
  if (!s) return;
  const conducted = (s.conducted || 0) + 1;
  const attended = (s.attended || 0) + (present ? 1 : 0);
  await update(SUBJ_STORE, subjectId, { conducted, attended });
  await create(LOG_STORE, { subjectId, date: nowISO(), status: present ? 'attended' : 'absent' });
  toast(present ? 'Marked present.' : 'Marked absent.', 'success');
  await reload();
}

function openSubjectModal(subject) {
  const isEdit = Boolean(subject);
  openFormModal({
    title: isEdit ? 'Edit subject' : 'Add subject',
    submitLabel: isEdit ? 'Save changes' : 'Add subject',
    values: subject || { requiredPercentage: 75, sessionType: 'Lecture', conducted: 0, attended: 0 },
    fields: [
      { name: 'name', label: 'Subject name', type: 'text', required: true, placeholder: 'e.g. Engineering Mathematics II' },
      { name: 'code', label: 'Subject code (optional)', type: 'text' },
      { name: 'credits', label: 'Credits (optional)', type: 'number', min: 0 },
      { name: 'sessionType', label: 'Session type', type: 'select', options: ['Lecture', 'Practical', 'Tutorial', 'Other'] },
      { name: 'requiredPercentage', label: 'Required attendance %', type: 'number', min: 1, max: 100, required: true },
      { name: 'conducted', label: 'Classes conducted so far', type: 'number', min: 0, required: true },
      { name: 'attended', label: 'Classes attended so far', type: 'number', min: 0, required: true },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this subject?', body: `"${subject.name}" and its attendance history will be permanently removed.`, confirmLabel: 'Delete',
        onConfirm: async () => { await remove(SUBJ_STORE, subject.id); closeModal(); toast('Subject deleted.', 'success'); await reload(); },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.name.trim()) { toast('Give the subject a name.', 'error'); return; }
      if (data.attended > data.conducted) { toast('Attended classes can\u2019t exceed conducted classes.', 'error'); return; }
      if (data.requiredPercentage < 1 || data.requiredPercentage > 100) { toast('Required percentage must be between 1 and 100.', 'error'); return; }
      if (isEdit) { await update(SUBJ_STORE, subject.id, data); toast('Subject updated.', 'success'); }
      else { await create(SUBJ_STORE, data); toast('Subject added.', 'success'); }
      closeModal();
      await reload();
    },
  });
}
