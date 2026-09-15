/**
 * tasks.js — Tasks module (spec Instructions 5–6).
 * Reminders are integrated here (not a separate module) via the browser
 * Notification wrapper in core/notifications.js.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, create, update, remove } from '../core/db.js?v=5';
import { ensureCategories, addCategory } from '../core/categories.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast, requestNotificationPermission } from '../core/notifications.js?v=5';
import { formatDate, daysBetween, escapeHTML, debounce, staggerChildren } from '../core/utils.js?v=5';
import { getDeepLinkId } from '../core/search.js?v=5';

const STORE = CONFIG.stores.tasks.name;
const CAT_STORE = CONFIG.stores.taskCategories.name;

let allTasks = [];
let categories = [];
let state = { view: 'all', search: '', category: 'all', priority: 'all', sort: 'dueDate' };

export async function initTasks() {
  categories = await ensureCategories(CAT_STORE, CONFIG.defaults.taskCategories);
  await reload();
  bindToolbar();

  const openId = getDeepLinkId();
  if (openId) {
    const task = allTasks.find((t) => t.id === openId);
    if (task) openTaskModal(task);
  }
}

async function reload() {
  allTasks = await getAll(STORE);
  render();
}

function bindToolbar() {
  const searchInput = document.getElementById('task-search');
  searchInput.addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  }, 200));

  document.querySelectorAll('.tab[data-view]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.view = tab.dataset.view;
      document.querySelectorAll('.tab[data-view]').forEach((t) => t.classList.toggle('is-active', t === tab));
      render();
    });
  });

  const catSelect = document.getElementById('task-filter-category');
  const prioritySelect = document.getElementById('task-filter-priority');
  const sortSelect = document.getElementById('task-sort');

  populateCategorySelect(catSelect);

  catSelect.addEventListener('change', (e) => { state.category = e.target.value; render(); });
  prioritySelect.addEventListener('change', (e) => { state.priority = e.target.value; render(); });
  sortSelect.addEventListener('change', (e) => { state.sort = e.target.value; render(); });

  document.getElementById('task-reset-filters').addEventListener('click', () => {
    state = { view: state.view, search: '', category: 'all', priority: 'all', sort: 'dueDate' };
    searchInput.value = '';
    catSelect.value = 'all';
    prioritySelect.value = 'all';
    sortSelect.value = 'dueDate';
    render();
  });

  document.getElementById('task-add-btn').addEventListener('click', () => openTaskModal());
}

function populateCategorySelect(select) {
  select.innerHTML = `<option value="all">All categories</option>` +
    categories.map((c) => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
}

function filteredTasks() {
  const today = new Date();
  let list = [...allTasks];

  if (state.view === 'today') {
    list = list.filter((t) => t.dueDate && daysBetween(today, t.dueDate) === 0 && t.status !== 'completed');
  } else if (state.view === 'upcoming') {
    list = list.filter((t) => t.dueDate && daysBetween(today, t.dueDate) > 0 && t.status !== 'completed');
  } else if (state.view === 'overdue') {
    list = list.filter((t) => t.dueDate && daysBetween(today, t.dueDate) < 0 && t.status !== 'completed');
  } else if (state.view === 'completed') {
    list = list.filter((t) => t.status === 'completed');
  }
  // 'all' → no view filter

  if (state.search) {
    list = list.filter((t) => (t.title || '').toLowerCase().includes(state.search)
      || (t.description || '').toLowerCase().includes(state.search));
  }
  if (state.category !== 'all') list = list.filter((t) => t.category === state.category);
  if (state.priority !== 'all') list = list.filter((t) => t.priority === state.priority);

  list.sort((a, b) => {
    if (state.sort === 'dueDate') return new Date(a.dueDate || '9999-12-31') - new Date(b.dueDate || '9999-12-31');
    if (state.sort === 'priority') {
      const rank = { High: 0, Medium: 1, Low: 2 };
      return (rank[a.priority] ?? 3) - (rank[b.priority] ?? 3);
    }
    if (state.sort === 'created') return new Date(b.createdAt) - new Date(a.createdAt);
    return 0;
  });

  return list;
}

const PRIORITY_COLOR = { High: 'var(--danger)', Medium: 'var(--accent)', Low: 'var(--info)' };

function render() {
  const mount = document.getElementById('task-list');
  const list = filteredTasks();

  document.getElementById('task-count').textContent = `${list.length} task${list.length === 1 ? '' : 's'}`;

  if (!allTasks.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);">
      <span class="empty-state__title">No tasks yet</span>
      <span class="empty-state__body">Add your first assignment, exam, or deadline — it'll show up on your Dashboard too.</span>
    </div>`;
    return;
  }
  if (!list.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);">
      <span class="empty-state__title">Nothing here</span>
      <span class="empty-state__body">No tasks match this view and filter combination.</span>
    </div>`;
    return;
  }

  mount.innerHTML = list.map((t) => {
    const isDone = t.status === 'completed';
    const overdue = t.dueDate && daysBetween(new Date(), t.dueDate) < 0 && !isDone;
    return `
      <div class="card list-row" data-id="${t.id}">
        <button class="list-row__check ${isDone ? 'is-checked' : ''}" data-toggle="${t.id}" aria-label="${isDone ? 'Mark incomplete' : 'Mark complete'}">
          ${isDone ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 12l5 5L20 6"/></svg>' : ''}
        </button>
        <div class="list-row__main" data-open="${t.id}">
          <div class="list-row__title ${isDone ? 'is-done' : ''}">${escapeHTML(t.title)}</div>
          <div class="list-row__meta">
            <span>${escapeHTML(t.category || 'Uncategorised')}</span>
            ${t.dueDate ? `<span style="color:${overdue ? 'var(--danger)' : 'inherit'}">${overdue ? 'Overdue · ' : ''}${formatDate(t.dueDate)}</span>` : '<span>No due date</span>'}
            ${t.reminderEnabled ? '<span>🔔 Reminder on</span>' : ''}
          </div>
        </div>
        <span class="badge" style="background:color-mix(in srgb, ${PRIORITY_COLOR[t.priority] || 'var(--ink-faint)'} 16%, transparent); color:${PRIORITY_COLOR[t.priority] || 'var(--ink-faint)'}">${escapeHTML(t.priority || 'None')}</span>
      </div>
    `;
  }).join('');

  mount.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleComplete(btn.dataset.toggle);
    });
  });
  mount.querySelectorAll('[data-open]').forEach((row) => {
    row.addEventListener('click', () => openTaskModal(allTasks.find((t) => t.id === row.dataset.open)));
  });
  staggerChildren(mount, '.list-row');
}

async function toggleComplete(id) {
  const t = allTasks.find((x) => x.id === id);
  if (!t) return;
  const next = t.status === 'completed' ? 'pending' : 'completed';
  await update(STORE, id, { status: next, completedAt: next === 'completed' ? new Date().toISOString() : null });
  toast(next === 'completed' ? 'Task marked complete.' : 'Task marked incomplete.', 'success');
  await reload();
}

function openTaskModal(task, presetValues) {
  const isEdit = Boolean(task);
  const values = presetValues || task || { priority: 'Medium', category: categories[0]?.name || '' };

  openFormModal({
    title: isEdit ? 'Edit task' : 'New task',
    submitLabel: isEdit ? 'Save changes' : 'Add task',
    values,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Submit DSA assignment' },
      { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional details' },
      { name: 'dueDate', label: 'Due date', type: 'date' },
      { name: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High'] },
      { name: 'category', label: 'Category', type: 'select', options: [...categories.map((c) => c.name), { value: '__new__', label: '+ New category…' }] },
      { name: 'reminderOffsetDays', label: 'Reminder', type: 'select', options: [
        { value: '', label: 'No reminder' },
        { value: '0', label: 'On the due date' },
        { value: '1', label: '1 day before' },
        { value: '2', label: '2 days before' },
        { value: '3', label: '3 days before' },
      ] },
      { name: 'reminderTime', label: 'Reminder time', type: 'text', placeholder: 'e.g. 09:00 (24-hour)' },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this task?',
        body: `"${task.title}" will be permanently removed.`,
        confirmLabel: 'Delete',
        onConfirm: async () => {
          await remove(STORE, task.id);
          closeModal();
          toast('Task deleted.', 'success');
          await reload();
        },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.title.trim()) { toast('Give the task a title.', 'error'); return; }

      const wantsReminder = data.reminderOffsetDays !== '';
      if (wantsReminder && !data.dueDate) { toast('A reminder needs a due date to count from.', 'error'); return; }
      if (wantsReminder && data.reminderTime && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(data.reminderTime.trim())) {
        toast('Reminder time should look like 09:00 or 18:30 (24-hour).', 'error'); return;
      }
      data.reminderEnabled = wantsReminder;
      data.reminderOffsetDays = wantsReminder ? Number(data.reminderOffsetDays) : null;
      data.reminderTime = wantsReminder ? (data.reminderTime.trim() || '09:00') : null;

      if (wantsReminder) {
        const perm = await requestNotificationPermission();
        if (perm === 'denied') toast('Notifications are blocked — CampusOS will still remind you in-app.', 'info');
      }

      if (isEdit) {
        await update(STORE, task.id, data);
        toast('Task updated.', 'success');
      } else {
        await create(STORE, { ...data, status: 'pending' });
        toast('Task added.', 'success');
      }
      closeModal();
      await reload();
    },
  });

  // Intercept "+ New category…" without losing the rest of the form —
  // capture current field values, swap to a tiny category-name modal,
  // then reopen this same task modal pre-filled with the new category.
  const catSelect = document.getElementById('f_category');
  catSelect.addEventListener('change', (e) => {
    if (e.target.value !== '__new__') return;
    const form = catSelect.closest('form');
    const snapshot = {
      title: form.elements.title.value,
      description: form.elements.description.value,
      dueDate: form.elements.dueDate.value,
      priority: form.elements.priority.value,
      reminderOffsetDays: form.elements.reminderOffsetDays.value,
      reminderTime: form.elements.reminderTime.value,
    };
    openFormModal({
      title: 'New category',
      submitLabel: 'Add category',
      fields: [{ name: 'name', label: 'Category name', type: 'text', required: true, placeholder: 'e.g. Club Activity' }],
      onSubmit: async (catData) => {
        if (!catData.name.trim()) { toast('Give the category a name.', 'error'); return; }
        const cat = await addCategory(CAT_STORE, catData.name);
        categories = await getAll(CAT_STORE);
        populateCategorySelect(document.getElementById('task-filter-category'));
        closeModal();
        openTaskModal(task, { ...snapshot, category: cat.name });
      },
    });
  });
}


