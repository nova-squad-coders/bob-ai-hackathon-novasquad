/**
 * achievements.js — Achievements Vault (Instructions 20–23).
 * Organization is flexible: category + an optional free-text
 * sub-organization field (e.g. category "Courses", subgroup "IBM") so
 * nesting isn't forced into a fixed structure (Note 8).
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, create, update, remove } from '../core/db.js?v=5';
import { ensureCategories, addCategory } from '../core/categories.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast } from '../core/notifications.js?v=5';
import { escapeHTML, debounce, formatDate, staggerChildren } from '../core/utils.js?v=5';
import { getDeepLinkId } from '../core/search.js?v=5';
import { validateNotFuture } from '../core/validators.js?v=5';

const STORE = CONFIG.stores.achievements.name;
const CAT_STORE = CONFIG.stores.achievementCategories.name;

let achievements = [];
let categories = [];
let state = { search: '', category: 'all' };

export async function initAchievements() {
  categories = await ensureCategories(CAT_STORE, CONFIG.defaults.achievementCategories);
  await reload();
  bindToolbar();
  document.getElementById('ach-add-btn').addEventListener('click', () => openAchievementModal());

  const openId = getDeepLinkId();
  if (openId) {
    const achievement = achievements.find((a) => a.id === openId);
    if (achievement) openAchievementModal(achievement);
  }
}

async function reload() {
  achievements = await getAll(STORE);
  render();
}

function bindToolbar() {
  document.getElementById('ach-search').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  }, 200));
  const catSelect = document.getElementById('ach-filter-category');
  populateCategorySelect(catSelect);
  catSelect.addEventListener('change', (e) => { state.category = e.target.value; render(); });
}

function populateCategorySelect(select) {
  select.innerHTML = `<option value="all">All categories</option>` +
    categories.map((c) => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
}

function render() {
  const mount = document.getElementById('ach-grid');
  let list = [...achievements];
  if (state.search) {
    list = list.filter((a) => [a.title, a.issuer, a.subgroup, a.description, (a.tags || []).join(' ')]
      .filter(Boolean).some((f) => f.toLowerCase().includes(state.search)));
  }
  if (state.category !== 'all') list = list.filter((a) => a.category === state.category);
  list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  if (!achievements.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);grid-column:1/-1;">
      <span class="empty-state__title">Your vault is empty</span>
      <span class="empty-state__body">Save every certificate and win as you earn it — even small ones — so nothing gets forgotten by resume time.</span>
    </div>`;
    return;
  }
  if (!list.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);grid-column:1/-1;"><span class="empty-state__title">No matches</span><span class="empty-state__body">Try a different search or category.</span></div>`;
    return;
  }

  // Group by category → subgroup for a lightly nested feel without forcing structure.
  const grouped = {};
  for (const a of list) {
    const key = a.category || 'Other';
    grouped[key] = grouped[key] || {};
    const sub = a.subgroup || '';
    grouped[key][sub] = grouped[key][sub] || [];
    grouped[key][sub].push(a);
  }

  mount.innerHTML = Object.entries(grouped).map(([cat, subgroups]) => `
    <div style="grid-column:1/-1;">
      <div class="section-title">${escapeHTML(cat)}</div>
      <div class="grid">
        ${Object.entries(subgroups).map(([sub, list2]) => list2.map((a) => achievementCard(a, sub)).join('')).join('')}
      </div>
    </div>
  `).join('');

  mount.querySelectorAll('[data-open]').forEach((card) => {
    card.addEventListener('click', () => openAchievementModal(achievements.find((a) => a.id === card.dataset.open)));
  });
  staggerChildren(mount, '.item-card');
}

function achievementCard(a, sub) {
  return `
    <div class="card item-card" data-open="${a.id}">
      <div class="item-card__top">
        <div class="item-card__avatar" style="border-radius:10px;font-size:18px;">🏆</div>
        <div style="min-width:0;">
          <div class="item-card__name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(a.title)}</div>
          <div class="item-card__sub">${escapeHTML(sub || a.issuer || '')}</div>
        </div>
      </div>
      <div class="item-card__body">
        ${a.date ? `<div>${formatDate(a.date)}</div>` : ''}
        ${a.certificateFileName ? `<div style="margin-top:6px;">📎 ${escapeHTML(a.certificateFileName)}</div>` : ''}
      </div>
    </div>
  `;
}

function openAchievementModal(achievement) {
  const isEdit = Boolean(achievement);
  openFormModal({
    title: isEdit ? 'Edit achievement' : 'Add achievement',
    submitLabel: isEdit ? 'Save changes' : 'Save',
    values: achievement || { category: categories[0]?.name || '' },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Smart India Hackathon — Finalist' },
      { name: 'category', label: 'Category', type: 'select', options: [...categories.map((c) => c.name), { value: '__new__', label: '+ New category…' }] },
      { name: 'subgroup', label: 'Sub-group (optional)', type: 'text', placeholder: 'e.g. IBM, or Team Name' },
      { name: 'issuer', label: 'Issuing organization', type: 'text' },
      { name: 'date', label: 'Date', type: 'date', max: new Date().toISOString().slice(0, 10) },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'credentialId', label: 'Credential ID', type: 'text' },
      { name: 'credentialUrl', label: 'Credential URL', type: 'text' },
      { name: 'tags', label: 'Tags (comma-separated)', type: 'text' },
      { name: 'certificateFile', label: 'Certificate / image / PDF (optional)', type: 'file' },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this achievement?', body: `"${achievement.title}" will be permanently removed.`, confirmLabel: 'Delete',
        onConfirm: async () => { await remove(STORE, achievement.id); closeModal(); toast('Achievement deleted.', 'success'); await reload(); },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.title.trim()) { toast('Give it a title.', 'error'); return; }
      const dateError = validateNotFuture(data.date, 'Achievement date');
      if (dateError) { toast(dateError, 'error'); return; }
      const urlError = data.credentialUrl && !/^https?:\/\//i.test(data.credentialUrl.trim())
        ? 'Credential URL should start with http:// or https://' : null;
      if (urlError) { toast(urlError, 'error'); return; }
      const tags = data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
      const payload = {
        title: data.title, category: data.category, subgroup: data.subgroup, issuer: data.issuer,
        date: data.date, description: data.description, credentialId: data.credentialId,
        credentialUrl: data.credentialUrl, tags,
      };
      if (data.certificateFile) {
        payload.certificateFileName = data.certificateFile.name;
        payload.certificateFileMime = data.certificateFile.type;
        payload.certificateBlob = data.certificateFile;
      }
      try {
        if (isEdit) { await update(STORE, achievement.id, payload); toast('Achievement updated.', 'success'); }
        else { await create(STORE, payload); toast('Achievement saved.', 'success'); }
      } catch (err) {
        toast('Couldn\u2019t save — the attached file may be too large for this browser\u2019s storage.', 'error', 7000);
        return;
      }
      closeModal();
      await reload();
    },
  });

  const catSelect = document.getElementById('f_category');
  catSelect.addEventListener('change', (e) => {
    if (e.target.value !== '__new__') return;
    openFormModal({
      title: 'New achievement category',
      submitLabel: 'Add category',
      fields: [{ name: 'name', label: 'Category name', type: 'text', required: true }],
      onSubmit: async (catData) => {
        if (!catData.name.trim()) { toast('Give the category a name.', 'error'); return; }
        const cat = await addCategory(CAT_STORE, catData.name);
        categories = await getAll(CAT_STORE);
        populateCategorySelect(document.getElementById('ach-filter-category'));
        closeModal();
        openAchievementModal({ ...(achievement || {}), category: cat.name });
      },
    });
  });
}
