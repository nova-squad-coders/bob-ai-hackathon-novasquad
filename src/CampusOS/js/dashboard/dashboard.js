/**
 * dashboard.js — the command center. Every widget here follows the same
 * rule (spec Instruction 4, Note 11): read real data from db.js, and if a
 * module has no data yet, render a short empty state that points at the
 * module — never a zero-filled chart or fabricated stat.
 *
 * This file currently reads from stores that no other module writes to
 * yet (Tasks, Spendee, etc. are still 'planned' per config.js), so on a
 * fresh install every widget will legitimately show its empty state.
 * That's expected — it's what "adapts gracefully with no data" looks like
 * before Phase 2 (Tasks) exists.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll } from '../core/db.js?v=5';
import { formatDate, formatCurrency, daysBetween, escapeHTML, staggerChildren } from '../core/utils.js?v=5';
import { icon } from '../core/navigation.js?v=5';

const S = CONFIG.stores;

export async function renderDashboard() {
  renderGreeting();
  renderWidgetIcons();

  const [tasks, transactions, debts, performance, achievements, libraryItems, attendanceSubjects] = await Promise.all([
    safeGetAll(S.tasks.name),
    safeGetAll(S.transactions.name),
    safeGetAll(S.debts.name),
    safeGetAll(S.performance.name),
    safeGetAll(S.achievements.name),
    safeGetAll(S.libraryItems.name),
    safeGetAll(S.attendanceSubjects.name),
  ]);

  renderHero(tasks, transactions, debts, performance, achievements, attendanceSubjects);
  renderTodayWidget(tasks);
  renderUpcomingWidget(tasks);
  renderMoneyWidget(transactions, debts);
  renderAcademicsWidget(performance);
  renderAchievementsWidget(achievements);
  renderLibraryWidget(libraryItems);
  renderAttendanceWidget(attendanceSubjects);
  staggerChildren(document.querySelector('.dash-grid'), ':scope > .widget');
}

function renderWidgetIcons() {
  document.querySelectorAll('.widget__icon[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}

async function safeGetAll(storeName) {
  try {
    return await getAll(storeName);
  } catch {
    return [];
  }
}

function renderGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  const greetingEl = document.getElementById('dash-greeting');
  const dateEl = document.getElementById('dash-date');
  if (greetingEl) greetingEl.textContent = `Good ${part}.`;
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
  }
}

/** A compact "at a glance" strip above the widget grid — only shows a
 * stat once there's real data behind it, same empty-safe rule as every
 * widget below. */
function renderHero(tasks, transactions, debts, performance, achievements, attendanceSubjects) {
  const mount = document.getElementById('dash-hero');
  if (!mount) return;

  const today = new Date();
  const dueToday = tasks.filter((t) => t.dueDate && daysBetween(today, t.dueDate) === 0 && t.status !== 'completed').length;
  const overdue = tasks.filter((t) => t.dueDate && daysBetween(today, t.dueDate) < 0 && t.status !== 'completed').length;

  const thisMonth = today.getMonth();
  const spentThisMonth = transactions
    .filter((t) => t.type === 'expense' && new Date(t.date).getMonth() === thisMonth)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const avgAttendance = attendanceSubjects.length
    ? attendanceSubjects.reduce((sum, s) => sum + (s.conducted ? (s.attended / s.conducted) * 100 : 0), 0) / attendanceSubjects.length
    : null;

  const overallAcademic = performance.length
    ? performance.reduce((sum, p) => sum + (Number(p.obtainedMarks) / Number(p.maxMarks)) * 100, 0) / performance.length
    : null;

  const cards = [];
  if (tasks.length) {
    cards.push({
      icon: 'check-square',
      label: overdue > 0 ? 'Overdue tasks' : 'Due today',
      value: overdue > 0 ? overdue : dueToday,
      tone: overdue > 0 ? 'danger' : dueToday > 0 ? 'accent' : 'success',
    });
  }
  if (transactions.length) {
    cards.push({ icon: 'wallet', label: 'Spent this month', value: formatCurrency(spentThisMonth), tone: 'info' });
  }
  if (avgAttendance !== null) {
    cards.push({ icon: 'calendar-check', label: 'Avg. attendance', value: `${avgAttendance.toFixed(0)}%`, tone: avgAttendance < 75 ? 'danger' : 'success' });
  }
  if (overallAcademic !== null) {
    cards.push({ icon: 'trending-up', label: 'Academic average', value: `${overallAcademic.toFixed(0)}%`, tone: 'accent' });
  }
  if (achievements.length) {
    cards.push({ icon: 'award', label: 'Achievements saved', value: achievements.length, tone: 'accent' });
  }

  if (!cards.length) { mount.innerHTML = ''; mount.hidden = true; return; }
  mount.hidden = false;
  mount.innerHTML = cards.map((c) => `
    <div class="hero-card hero-card--${c.tone}">
      <span class="hero-card__icon">${icon(c.icon)}</span>
      <div>
        <div class="hero-card__value">${typeof c.value === 'number' ? c.value : escapeHTML(String(c.value))}</div>
        <div class="hero-card__label">${escapeHTML(c.label)}</div>
      </div>
    </div>
  `).join('');
  staggerChildren(mount, '.hero-card');
}

function emptyState(mount, title, body, linkLabel, href) {
  mount.innerHTML = `
    <div class="empty-state">
      <span class="empty-state__title">${escapeHTML(title)}</span>
      <span class="empty-state__body">${escapeHTML(body)}</span>
      ${linkLabel ? `<a class="empty-state__action" href="${href}">${escapeHTML(linkLabel)} →</a>` : ''}
    </div>
  `;
}

const PRIORITY_COLOR = { High: 'var(--danger)', Medium: 'var(--accent)', Low: 'var(--info)' };

function taskRow(task) {
  const dueLabel = task.dueDate ? formatDate(task.dueDate) : 'No due date';
  return `
    <div class="task-row">
      <span class="task-row__dot" style="background:${PRIORITY_COLOR[task.priority] || 'var(--ink-faint)'}"></span>
      <span class="task-row__title">${escapeHTML(task.title || 'Untitled task')}</span>
      <span class="task-row__meta">${escapeHTML(dueLabel)}</span>
    </div>
  `;
}

function renderTodayWidget(tasks) {
  const mount = document.getElementById('widget-today-body');
  if (!mount) return;
  const today = new Date();
  const dueToday = tasks.filter((t) => t.dueDate && daysBetween(today, t.dueDate) === 0 && t.status !== 'completed');
  const overdue = tasks.filter((t) => t.dueDate && daysBetween(today, t.dueDate) < 0 && t.status !== 'completed');
  const relevant = [...overdue, ...dueToday];

  if (!tasks.length) {
    emptyState(mount, 'No tasks yet', 'Add assignments, exams, and deadlines in Tasks and they\u2019ll show up here.', 'Go to Tasks', CONFIG.modules.find((m) => m.id === 'tasks').href);
    return;
  }
  if (!relevant.length) {
    emptyState(mount, 'Nothing due today', 'You\u2019re clear for today \u2014 check Upcoming for what\u2019s next.');
    return;
  }
  mount.innerHTML = relevant.slice(0, 6).map(taskRow).join('');
}

function renderUpcomingWidget(tasks) {
  const mount = document.getElementById('widget-upcoming-body');
  if (!mount) return;
  const today = new Date();
  const upcoming = tasks
    .filter((t) => t.dueDate && daysBetween(today, t.dueDate) > 0 && daysBetween(today, t.dueDate) <= 7 && t.status !== 'completed')
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  if (!tasks.length) {
    emptyState(mount, 'Nothing to preview', 'Upcoming deadlines from Tasks will appear here once you add some.');
    return;
  }
  if (!upcoming.length) {
    emptyState(mount, 'No deadlines this week', 'Nothing due in the next 7 days.');
    return;
  }
  mount.innerHTML = upcoming.slice(0, 6).map(taskRow).join('');
}

function renderMoneyWidget(transactions, debts) {
  const mount = document.getElementById('widget-money-body');
  if (!mount) return;

  if (!transactions.length && !debts.length) {
    emptyState(mount, 'No spending tracked', 'Log an expense or a debt in Spendee to see your money picture here.', 'Go to Spendee', CONFIG.modules.find((m) => m.id === 'spendee').href);
    return;
  }

  const thisMonth = new Date().getMonth();
  const spentThisMonth = transactions
    .filter((t) => t.type === 'expense' && new Date(t.date).getMonth() === thisMonth)
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const owedToMe = debts.filter((d) => d.direction === 'owed_to_me' && !d.settled)
    .reduce((sum, d) => sum + remainingBalance(d), 0);
  const owedByMe = debts.filter((d) => d.direction === 'i_owe' && !d.settled)
    .reduce((sum, d) => sum + remainingBalance(d), 0);

  mount.innerHTML = `
    <span class="empty-state__title">Spent this month</span>
    <div class="money-figure">${formatCurrency(spentThisMonth)}</div>
    <div class="money-line"><span>Owed to me</span><strong style="color:var(--success)">${formatCurrency(owedToMe)}</strong></div>
    <div class="money-line"><span>I owe</span><strong style="color:var(--danger)">${formatCurrency(owedByMe)}</strong></div>
  `;
}

function remainingBalance(debt) {
  const repaid = (debt.repayments || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
  return Math.max(0, Number(debt.amount || 0) - repaid);
}

function renderAcademicsWidget(performance) {
  const mount = document.getElementById('widget-academics-body');
  if (!mount) return;
  if (!performance.length) {
    emptyState(mount, 'No results logged', 'Add test and exam marks in Performance to track how you\u2019re doing by subject.', 'Go to Performance', CONFIG.modules.find((m) => m.id === 'performance').href);
    return;
  }
  const avg = performance.reduce((sum, p) => sum + (Number(p.obtainedMarks) / Number(p.maxMarks)) * 100, 0) / performance.length;
  const recent = [...performance].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

  mount.innerHTML = `
    <div class="stat-inline"><span class="stat-inline__value">${avg.toFixed(1)}%</span><span class="stat-inline__label">overall average</span></div>
    ${recent.map((p) => `
      <div class="money-line">
        <span>${escapeHTML(p.subject)} \u2014 ${escapeHTML(p.assessmentType)}</span>
        <strong>${p.obtainedMarks}/${p.maxMarks}</strong>
      </div>`).join('')}
  `;
}

function renderAchievementsWidget(achievements) {
  const mount = document.getElementById('widget-achievements-body');
  if (!mount) return;
  if (!achievements.length) {
    emptyState(mount, 'Vault is empty', 'Save certificates and wins as you earn them so you never forget one at resume time.', 'Go to Achievements', CONFIG.modules.find((m) => m.id === 'achievements').href);
    return;
  }
  const recent = [...achievements].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  mount.innerHTML = `
    <div class="stat-inline"><span class="stat-inline__value">${achievements.length}</span><span class="stat-inline__label">saved</span></div>
    ${recent.map((a) => `<div class="money-line"><span>${escapeHTML(a.title)}</span><span class="task-row__meta">${formatDate(a.date)}</span></div>`).join('')}
  `;
}

function renderLibraryWidget(libraryItems) {
  const mount = document.getElementById('widget-library-body');
  if (!mount) return;
  if (!libraryItems.length) {
    emptyState(mount, 'Library is empty', 'Upload notes, PDFs, and practice material so it stops living across five different apps.', 'Go to Library', CONFIG.modules.find((m) => m.id === 'library').href);
    return;
  }
  const recent = [...libraryItems].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  mount.innerHTML = recent.map((item) => `
    <div class="money-line"><span>${escapeHTML(item.title)}</span><span class="task-row__meta">${escapeHTML(item.subject || '')}</span></div>
  `).join('');
}

function renderAttendanceWidget(subjects) {
  const mount = document.getElementById('widget-attendance-body');
  if (!mount) return;
  if (!subjects.length) {
    emptyState(mount, 'Attendance isn\u2019t set up', 'Add your subjects in Attendance to see live percentages and safe-to-skip estimates here.', 'Go to Attendance', CONFIG.modules.find((m) => m.id === 'attendance').href);
    return;
  }
  mount.innerHTML = subjects.map((s) => {
    const pct = s.conducted ? ((s.attended / s.conducted) * 100).toFixed(1) : '0.0';
    const short = Number(pct) < Number(s.requiredPercentage || 75);
    return `
      <div class="money-line">
        <span>${escapeHTML(s.name)}</span>
        <strong style="color:${short ? 'var(--danger)' : 'var(--success)'}">${pct}%</strong>
      </div>`;
  }).join('');
}
