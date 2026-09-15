/**
 * people.js — student contact book (Instructions 11–13). Category names
 * are user-editable (categories.js), only name + one contact method are
 * required; everything else is optional.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, create, update, remove } from '../core/db.js?v=5';
import { ensureCategories, addCategory } from '../core/categories.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast } from '../core/notifications.js?v=5';
import { escapeHTML, debounce, formatDate, staggerChildren } from '../core/utils.js?v=5';
import { getDeepLinkId } from '../core/search.js?v=5';
import { validatePhone, validateEmail, validateNotTodayOrFuture } from '../core/validators.js?v=5';

const STORE = CONFIG.stores.people.name;
const CAT_STORE = CONFIG.stores.peopleCategories.name;

let people = [];
let categories = [];
let state = { search: '', category: 'all' };

export async function initPeople() {
  categories = await ensureCategories(CAT_STORE, CONFIG.defaults.peopleCategories);
  await reload();
  bindToolbar();
  document.getElementById('people-add-btn').addEventListener('click', () => openPersonModal());

  const openId = getDeepLinkId();
  if (openId) {
    const person = people.find((p) => p.id === openId);
    if (person) openPersonModal(person);
  }
}

async function reload() {
  people = await getAll(STORE);
  render();
}

function bindToolbar() {
  document.getElementById('people-search').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  }, 200));

  const catSelect = document.getElementById('people-filter-category');
  populateCategorySelect(catSelect);
  catSelect.addEventListener('change', (e) => { state.category = e.target.value; render(); });

  document.getElementById('people-add-category-btn').addEventListener('click', () => {
    openFormModal({
      title: 'New contact category',
      submitLabel: 'Add category',
      fields: [{ name: 'name', label: 'Category name', type: 'text', required: true, placeholder: 'e.g. Roommates' }],
      onSubmit: async (data) => {
        if (!data.name.trim()) { toast('Give the category a name.', 'error'); return; }
        await addCategory(CAT_STORE, data.name);
        categories = await getAll(CAT_STORE);
        populateCategorySelect(catSelect);
        toast('Category added.', 'success');
        closeModal();
      },
    });
  });
}

function populateCategorySelect(select) {
  select.innerHTML = `<option value="all">All categories</option>` +
    categories.map((c) => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
}

function initials(name) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function render() {
  const mount = document.getElementById('people-grid');
  let list = [...people];
  if (state.search) {
    list = list.filter((p) => [p.name, p.email, p.phone, p.notes, p.college, p.department]
      .filter(Boolean).some((f) => f.toLowerCase().includes(state.search)));
  }
  if (state.category !== 'all') list = list.filter((p) => p.category === state.category);
  list.sort((a, b) => a.name.localeCompare(b.name));

  if (!people.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);grid-column:1/-1;">
      <span class="empty-state__title">No contacts yet</span>
      <span class="empty-state__body">Add professors, classmates, or hostel friends to keep everyone in one place.</span>
    </div>`;
    return;
  }
  if (!list.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);grid-column:1/-1;"><span class="empty-state__title">No matches</span><span class="empty-state__body">Try a different search or category.</span></div>`;
    return;
  }

  mount.innerHTML = list.map((p) => `
    <div class="card item-card" data-open="${p.id}">
      <div class="item-card__top">
        <div class="item-card__avatar">${escapeHTML(initials(p.name || '?'))}</div>
        <div>
          <div class="item-card__name">${escapeHTML(p.name)}</div>
          <div class="item-card__sub">${escapeHTML(p.category || 'Uncategorised')}</div>
        </div>
      </div>
      <div class="item-card__body">
        ${p.phone ? `<div>${escapeHTML(p.phone)}</div>` : ''}
        ${p.email ? `<div>${escapeHTML(p.email)}</div>` : ''}
        ${p.birthday ? `<div>🎂 ${formatDate(p.birthday, { year: false })}</div>` : ''}
      </div>
    </div>
  `).join('');

  mount.querySelectorAll('[data-open]').forEach((card) => {
    card.addEventListener('click', () => openPersonModal(people.find((p) => p.id === card.dataset.open)));
  });
  staggerChildren(mount, '.item-card');
}

function openPersonModal(person) {
  const isEdit = Boolean(person);
  openFormModal({
    title: isEdit ? 'Edit contact' : 'New contact',
    submitLabel: isEdit ? 'Save changes' : 'Add contact',
    values: person || { category: categories[0]?.name || '' },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'category', label: 'Category', type: 'select', options: categories.map((c) => c.name) },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'birthday', label: 'Birthday (optional)', type: 'date', max: yesterdayISO() },
      { name: 'college', label: 'College', type: 'text' },
      { name: 'department', label: 'Department', type: 'text' },
      { name: 'semester', label: 'Semester', type: 'text' },
      { name: 'socialLink', label: 'Social / profile link', type: 'text', placeholder: 'LinkedIn, Instagram, etc.' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this contact?', body: `"${person.name}" will be permanently removed.`, confirmLabel: 'Delete',
        onConfirm: async () => { await remove(STORE, person.id); closeModal(); toast('Contact deleted.', 'success'); await reload(); },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.name.trim()) { toast('Add a name.', 'error'); return; }
      if (!data.phone.trim() && !data.email.trim()) { toast('Add at least a phone number or email.', 'error'); return; }

      const phoneError = validatePhone(data.phone);
      if (phoneError) { toast(phoneError, 'error'); return; }
      const emailError = validateEmail(data.email);
      if (emailError) { toast(emailError, 'error'); return; }
      const birthdayError = validateNotTodayOrFuture(data.birthday, 'Birthday');
      if (birthdayError) { toast(birthdayError, 'error'); return; }

      if (isEdit) { await update(STORE, person.id, data); toast('Contact updated.', 'success'); }
      else { await create(STORE, data); toast('Contact added.', 'success'); }
      closeModal();
      await reload();
    },
  });
}
