/**
 * performance.js — academic performance tracker (Instructions 14–15).
 * All analysis is computed from stored records only — no predictions
 * beyond what the data actually supports.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, create, update, remove, getConfigValue, setConfigValue } from '../core/db.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast } from '../core/notifications.js?v=5';
import { escapeHTML, formatDate, staggerChildren } from '../core/utils.js?v=5';
import { getDeepLinkId } from '../core/search.js?v=5';
import { validateNotFuture } from '../core/validators.js?v=5';

const STORE = CONFIG.stores.performance.name;
const GOALS_KEY = 'performanceGoals';
let records = [];
let goals = {}; // { subjectName: targetPercentage }

export async function initPerformance() {
  goals = await getConfigValue(GOALS_KEY, {});
  await reload();
  document.getElementById('perf-add-btn').addEventListener('click', () => openRecordModal());
  bindWhatIf();

  const openId = getDeepLinkId();
  if (openId) {
    const record = records.find((r) => r.id === openId);
    if (record) openRecordModal(record);
  }
}

async function reload() {
  records = await getAll(STORE);
  render();
}

function pct(r) {
  return r.maxMarks ? (Number(r.obtainedMarks) / Number(r.maxMarks)) * 100 : 0;
}

function subjectStats() {
  const bySubject = {};
  for (const r of records) {
    if (!bySubject[r.subject]) bySubject[r.subject] = [];
    bySubject[r.subject].push(r);
  }
  return Object.entries(bySubject).map(([subject, list]) => {
    const sorted = [...list].sort((a, b) => new Date(a.date) - new Date(b.date));
    const average = list.reduce((s, r) => s + pct(r), 0) / list.length;
    let trend = 'flat';
    if (sorted.length >= 2) {
      const diff = pct(sorted[sorted.length - 1]) - pct(sorted[sorted.length - 2]);
      trend = diff > 2 ? 'up' : diff < -2 ? 'down' : 'flat';
    }
    return { subject, average, count: list.length, records: sorted, trend };
  });
}

function trendArrow(trend) {
  if (trend === 'up') return `<span style="color:var(--success);font-weight:700;">▲</span>`;
  if (trend === 'down') return `<span style="color:var(--danger);font-weight:700;">▼</span>`;
  return `<span style="color:var(--ink-faint);">–</span>`;
}

function buildInsight(stats, overall) {
  if (records.length < 4) return null;
  const improving = stats.filter((s) => s.trend === 'up').map((s) => s.subject);
  const declining = stats.filter((s) => s.trend === 'down').map((s) => s.subject);
  const parts = [];
  if (improving.length) parts.push(`improving in ${improving.join(', ')}`);
  if (declining.length) parts.push(`slipping in ${declining.join(', ')}`);
  if (!parts.length) return `Your scores have been steady around ${overall.toFixed(0)}% overall — no major swings yet.`;
  return `You're ${parts.join(', and ')}, based on your most recent results in each.`;
}

function render() {
  const summaryMount = document.getElementById('perf-summary');
  const chartMount = document.getElementById('perf-chart');
  const listMount = document.getElementById('perf-list');

  if (!records.length) {
    summaryMount.innerHTML = '';
    chartMount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);">
      <span class="empty-state__title">No results logged</span>
      <span class="empty-state__body">Add a test, viva, or exam score to start building your academic record.</span>
    </div>`;
    listMount.innerHTML = '';
    return;
  }

  const stats = subjectStats();
  const overall = records.reduce((s, r) => s + pct(r), 0) / records.length;
  const sortedStats = [...stats].sort((a, b) => b.average - a.average);
  const best = sortedStats[0];
  const weak = sortedStats[sortedStats.length - 1];
  const insight = buildInsight(stats, overall);

  summaryMount.innerHTML = `
    <div class="stat-strip">
      <div class="card stat-card"><div class="stat-card__label">Overall average</div><div class="stat-card__value">${overall.toFixed(1)}%</div></div>
      <div class="card stat-card"><div class="stat-card__label">Records logged</div><div class="stat-card__value">${records.length}</div></div>
      ${stats.length > 1 ? `<div class="card stat-card"><div class="stat-card__label">Strongest area</div><div class="stat-card__value" style="font-size:var(--text-md);color:var(--success)">${escapeHTML(best.subject)}</div></div>` : ''}
      ${stats.length > 1 ? `<div class="card stat-card"><div class="stat-card__label">Needs attention</div><div class="stat-card__value" style="font-size:var(--text-md);color:var(--danger)">${escapeHTML(weak.subject)}</div></div>` : ''}
    </div>
    ${insight ? `<div class="card" style="padding:var(--space-4) var(--space-5);margin-bottom:var(--space-6);display:flex;gap:10px;align-items:flex-start;background:var(--bg-inset);border:none;">
      <span style="font-size:16px;">💡</span>
      <span style="font-size:var(--text-sm);color:var(--ink-soft);line-height:var(--leading-relaxed);">${escapeHTML(insight)}</span>
    </div>` : ''}
  `;

  const recentChronological = [...records].sort((a, b) => new Date(a.date) - new Date(b.date));

  chartMount.innerHTML = `
    ${recentChronological.length >= 2 ? `<div class="card" style="padding:var(--space-6);margin-bottom:var(--space-6);">
      <div class="section-title" style="margin-top:0;">Score trend over time</div>
      ${trendLineSVG(recentChronological)}
    </div>` : ''}
    <div class="card" style="padding:var(--space-6);margin-bottom:var(--space-6);">
      <div class="section-title" style="margin-top:0;">Subject comparison</div>
      ${stats.length >= 3 ? radarSVG(stats) : barRows(stats)}
    </div>
    <div class="grid" style="margin-bottom:var(--space-6);">
      ${sortedStats.map((s) => {
        const goal = goals[s.subject];
        const goalMet = goal && s.average >= goal;
        return `
        <div class="card" style="padding:var(--space-5);">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;font-size:var(--text-sm);">${escapeHTML(s.subject)}</span>
            ${trendArrow(s.trend)}
          </div>
          <div style="font-family:var(--font-display);font-size:var(--text-xl);margin:6px 0 4px;">${s.average.toFixed(1)}%</div>
          <div style="font-size:var(--text-xs);color:var(--ink-faint);margin-bottom:10px;">${s.count} result${s.count === 1 ? '' : 's'} logged</div>
          ${goal ? `
            <div class="progress-track" style="margin-bottom:6px;"><div class="progress-fill" style="width:${Math.min(100, (s.average / goal) * 100)}%;background:${goalMet ? 'var(--success)' : 'var(--accent)'};"></div></div>
            <div style="font-size:var(--text-xs);color:${goalMet ? 'var(--success)' : 'var(--ink-faint)'};">${goalMet ? `Goal reached (${goal}%)` : `${(goal - s.average).toFixed(1)}% to your ${goal}% goal`}</div>
          ` : ''}
          <button class="btn btn--ghost" data-set-goal="${escapeHTML(s.subject)}" style="margin-top:10px;width:100%;justify-content:center;font-size:var(--text-xs);padding:6px;">${goal ? 'Change goal' : 'Set a goal'}</button>
        </div>
      `;
      }).join('')}
    </div>

    <div class="card" style="padding:var(--space-6);margin-bottom:var(--space-6);">
      <div class="section-title" style="margin-top:0;">What if…</div>
      <p style="font-size:var(--text-xs);color:var(--ink-faint);margin-bottom:var(--space-4);">See how a hypothetical future result would move a subject's average — nothing here is saved.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
        <div class="field" style="margin-bottom:0;min-width:160px;">
          <label>Subject</label>
          <select id="whatif-subject">${stats.map((s) => `<option value="${escapeHTML(s.subject)}">${escapeHTML(s.subject)}</option>`).join('')}</select>
        </div>
        <div class="field" style="margin-bottom:0;width:100px;">
          <label>Score</label>
          <input type="number" id="whatif-obtained" min="0" placeholder="42" />
        </div>
        <div class="field" style="margin-bottom:0;width:100px;">
          <label>Out of</label>
          <input type="number" id="whatif-max" min="1" placeholder="50" />
        </div>
        <div id="whatif-result" style="font-size:var(--text-sm);color:var(--ink-soft);padding-bottom:10px;"></div>
      </div>
    </div>
  `;

  listMount.innerHTML = `<div class="section-title">History</div><div class="list">${[...records].sort((a, b) => new Date(b.date) - new Date(a.date)).map((r) => `
    <div class="card list-row" data-open="${r.id}" style="cursor:pointer;">
      <span style="width:10px;height:10px;border-radius:50%;background:${pct(r) >= 75 ? 'var(--success)' : pct(r) >= 50 ? 'var(--accent)' : 'var(--danger)'};flex-shrink:0;"></span>
      <div class="list-row__main">
        <div class="list-row__title">${escapeHTML(r.subject)} — ${escapeHTML(r.assessmentType)}</div>
        <div class="list-row__meta"><span>${formatDate(r.date)}</span>${r.notes ? `<span>${escapeHTML(r.notes)}</span>` : ''}</div>
      </div>
      <strong>${r.obtainedMarks}/${r.maxMarks} <span style="color:var(--ink-faint);font-weight:500;">(${pct(r).toFixed(0)}%)</span></strong>
    </div>
  `).join('')}</div>`;

  listMount.querySelectorAll('[data-open]').forEach((row) => {
    row.addEventListener('click', () => openRecordModal(records.find((r) => r.id === row.dataset.open)));
  });
  staggerChildren(listMount, '.list-row');
  staggerChildren(chartMount, '.grid > .card');

  chartMount.querySelectorAll('[data-set-goal]').forEach((btn) => {
    btn.addEventListener('click', () => openGoalModal(btn.dataset.setGoal));
  });
  bindWhatIf();
}

function openGoalModal(subject) {
  openFormModal({
    title: `Goal for ${subject}`,
    submitLabel: 'Save goal',
    values: { target: goals[subject] || '' },
    fields: [{ name: 'target', label: 'Target average % (blank to remove)', type: 'number', min: 1, max: 100 }],
    onSubmit: async (data) => {
      const next = { ...goals };
      if (data.target === null || data.target === '') delete next[subject];
      else next[subject] = Number(data.target);
      goals = next;
      await setConfigValue(GOALS_KEY, goals);
      closeModal();
      toast('Goal saved.', 'success');
      render();
    },
  });
}

/** Live, unsaved projection — recalculates on every keystroke so it
 * feels like a calculator, not a form to submit. */
function bindWhatIf() {
  const subjectSelect = document.getElementById('whatif-subject');
  const obtainedInput = document.getElementById('whatif-obtained');
  const maxInput = document.getElementById('whatif-max');
  const resultEl = document.getElementById('whatif-result');
  if (!subjectSelect || !obtainedInput || !maxInput || !resultEl) return;

  const compute = () => {
    const subject = subjectSelect.value;
    const obtained = Number(obtainedInput.value);
    const max = Number(maxInput.value);
    if (!subject || !max || obtained < 0 || obtained > max) { resultEl.textContent = ''; return; }
    const subjectRecords = records.filter((r) => r.subject === subject);
    const currentAvg = subjectRecords.reduce((s, r) => s + pct(r), 0) / subjectRecords.length;
    const projectedAvg = (subjectRecords.reduce((s, r) => s + pct(r), 0) + (obtained / max) * 100) / (subjectRecords.length + 1);
    const diff = projectedAvg - currentAvg;
    resultEl.innerHTML = `New average would be <strong>${projectedAvg.toFixed(1)}%</strong> <span style="color:${diff >= 0 ? 'var(--success)' : 'var(--danger)'}">(${diff >= 0 ? '+' : ''}${diff.toFixed(1)})</span>`;
  };

  [subjectSelect, obtainedInput, maxInput].forEach((el) => el.addEventListener('input', compute));
  compute();
}

/** A simple line chart of every result's percentage in chronological
 * order — shows overall trajectory across subjects, not just a single
 * subject's history. */
function trendLineSVG(sortedRecords) {
  const w = 560, h = 160, pad = 28;
  const points = sortedRecords.map((r, i) => {
    const x = pad + (i / Math.max(1, sortedRecords.length - 1)) * (w - pad * 2);
    const y = h - 20 - (pct(r) / 100) * (h - 40);
    return { x, y, r };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const gridLines = [0, 25, 50, 75, 100].map((v) => {
    const y = h - 20 - (v / 100) * (h - 40);
    return `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="var(--surface-border)" stroke-width="1" />
            <text x="4" y="${y + 3}" font-size="9" fill="var(--ink-faint)">${v}</text>`;
  }).join('');
  const dots = points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="var(--accent-strong)" />`).join('');

  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:560px;display:block;" role="img" aria-label="Score trend over time">
    ${gridLines}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}
  </svg>`;
}

function barRows(stats) {
  return stats.map((s) => `
    <div style="margin-bottom:var(--space-3);">
      <div style="display:flex;justify-content:space-between;font-size:var(--text-sm);margin-bottom:4px;">
        <span>${escapeHTML(s.subject)}</span><strong>${s.average.toFixed(1)}%</strong>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${s.average}%;background:var(--accent);"></div></div>
    </div>
  `).join('');
}

/** A small hand-built radar chart — no charting dependency. Each axis is
 * a subject; radius encodes its average percentage (0–100). */
function radarSVG(stats) {
  const size = 280;
  const center = size / 2;
  const radius = size / 2 - 40;
  const n = stats.length;
  const angleFor = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const points = stats.map((s, i) => {
    const r = (Math.max(s.average, 2) / 100) * radius;
    const a = angleFor(i);
    return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
  }).join(' ');

  const rings = [25, 50, 75, 100].map((val) => {
    const r = (val / 100) * radius;
    const ringPoints = Array.from({ length: n }, (_, i) => {
      const a = angleFor(i);
      return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
    }).join(' ');
    return `<polygon points="${ringPoints}" fill="none" stroke="var(--surface-border)" stroke-width="1"/>`;
  }).join('');

  const axisLines = stats.map((s, i) => {
    const a = angleFor(i);
    const x = center + radius * Math.cos(a);
    const y = center + radius * Math.sin(a);
    return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="var(--surface-border)" stroke-width="1"/>`;
  }).join('');

  const labels = stats.map((s, i) => {
    const a = angleFor(i);
    const x = center + (radius + 22) * Math.cos(a);
    const y = center + (radius + 22) * Math.sin(a);
    return `<text x="${x}" y="${y}" font-size="11" fill="var(--ink-soft)" text-anchor="middle" dominant-baseline="middle">${escapeHTML(s.subject)}</text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${size} ${size}" style="width:100%;max-width:340px;display:block;margin:0 auto;" role="img" aria-label="Subject performance radar chart">
      ${rings}${axisLines}
      <polygon points="${points}" fill="var(--accent)" fill-opacity="0.25" stroke="var(--accent-strong)" stroke-width="2"/>
      ${labels}
    </svg>
  `;
}

function openRecordModal(record) {
  const isEdit = Boolean(record);
  openFormModal({
    title: isEdit ? 'Edit result' : 'Log a result',
    submitLabel: isEdit ? 'Save changes' : 'Add result',
    values: record || { assessmentType: CONFIG.defaults.performanceTypes[0], date: new Date().toISOString().slice(0, 10) },
    fields: [
      { name: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'e.g. Data Structures' },
      { name: 'assessmentType', label: 'Assessment type', type: 'select', options: [...CONFIG.defaults.performanceTypes, 'Custom'] },
      { name: 'obtainedMarks', label: 'Marks obtained', type: 'number', min: 0, required: true },
      { name: 'maxMarks', label: 'Maximum marks', type: 'number', min: 1, required: true },
      { name: 'date', label: 'Date', type: 'date', required: true, max: new Date().toISOString().slice(0, 10) },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this result?', body: 'This cannot be undone.', confirmLabel: 'Delete',
        onConfirm: async () => { await remove(STORE, record.id); closeModal(); toast('Result deleted.', 'success'); await reload(); },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.subject.trim()) { toast('Add a subject.', 'error'); return; }
      if (!data.maxMarks || data.maxMarks <= 0) { toast('Maximum marks must be greater than zero.', 'error'); return; }
      if (data.obtainedMarks == null || data.obtainedMarks < 0) { toast('Enter the marks obtained.', 'error'); return; }
      if (data.obtainedMarks > data.maxMarks) { toast('Marks obtained can\u2019t exceed the maximum.', 'error'); return; }
      const dateError = validateNotFuture(data.date, 'Result date');
      if (dateError) { toast(dateError, 'error'); return; }
      if (isEdit) { await update(STORE, record.id, data); toast('Result updated.', 'success'); }
      else { await create(STORE, data); toast('Result added.', 'success'); }
      closeModal();
      await reload();
    },
  });
}
