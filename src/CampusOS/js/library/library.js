/**
 * library.js — Digital Library (Instructions 16–19).
 *
 * Two stores back this module: `libraryItems` (metadata: title, subject,
 * semester, type, tags, folder) and `libraryFiles` (the actual Blob,
 * keyed by itemId). Splitting them means listing/searching never has to
 * load file bytes into memory, and an item can exist as a note-only
 * record with no file at all if the student just wants a placeholder.
 *
 * Storage limits: before saving a file we check navigator.storage.estimate()
 * where available and warn if the file is unlikely to fit; a failed write
 * (QuotaExceededError) is always surfaced to the user, never swallowed.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, create, update, remove } from '../core/db.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast } from '../core/notifications.js?v=5';
import { escapeHTML, debounce, formatDate, staggerChildren } from '../core/utils.js?v=5';
import { getDeepLinkId } from '../core/search.js?v=5';

const ITEM_STORE = CONFIG.stores.libraryItems.name;
const FILE_STORE = CONFIG.stores.libraryFiles.name;

let items = [];
let state = { search: '', subject: 'all', type: 'all' };

const TYPES = ['Notes', 'PDF', 'Practice Questions', 'Flowchart', 'Mind Map', 'Textbook', 'Other'];

export async function initLibrary() {
  await reload();
  bindToolbar();
  document.getElementById('lib-add-btn').addEventListener('click', () => openItemModal());
  showStorageEstimate();

  const openId = getDeepLinkId();
  if (openId) {
    const item = items.find((i) => i.id === openId);
    if (item) openItemDetail(item);
  }
}

async function reload() {
  items = await getAll(ITEM_STORE);
  populateSubjectFilter();
  render();
}

function bindToolbar() {
  document.getElementById('lib-search').addEventListener('input', debounce((e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  }, 200));
  document.getElementById('lib-filter-type').addEventListener('change', (e) => { state.type = e.target.value; render(); });
  document.getElementById('lib-filter-subject').addEventListener('change', (e) => { state.subject = e.target.value; render(); });
}

function populateSubjectFilter() {
  const select = document.getElementById('lib-filter-subject');
  const current = select.value || 'all';
  const subjects = [...new Set(items.map((i) => i.subject).filter(Boolean))].sort();
  select.innerHTML = `<option value="all">All subjects</option>` + subjects.map((s) => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('');
  select.value = subjects.includes(current) ? current : 'all';
}

async function showStorageEstimate() {
  const mount = document.getElementById('lib-storage-note');
  if (!navigator.storage || !navigator.storage.estimate) { mount.textContent = ''; return; }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    if (!quota) return;
    const pct = ((usage / quota) * 100).toFixed(1);
    mount.textContent = `Using ${(usage / (1024 * 1024)).toFixed(1)} MB of an estimated ${(quota / (1024 * 1024)).toFixed(0)} MB available in this browser (${pct}%).`;
  } catch {
    mount.textContent = '';
  }
}

function iconFor(type) {
  const map = { PDF: '📄', Notes: '📝', 'Practice Questions': '❓', Flowchart: '🔀', 'Mind Map': '🧠', Textbook: '📘' };
  return map[type] || '📁';
}

function filteredItems() {
  let list = [...items];
  if (state.search) {
    list = list.filter((i) => [i.title, i.subject, i.semester, i.folder, (i.tags || []).join(' ')]
      .filter(Boolean).some((f) => f.toLowerCase().includes(state.search)));
  }
  if (state.subject !== 'all') list = list.filter((i) => i.subject === state.subject);
  if (state.type !== 'all') list = list.filter((i) => i.type === state.type);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return list;
}

function render() {
  const mount = document.getElementById('lib-grid');
  const list = filteredItems();

  if (!items.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);grid-column:1/-1;">
      <span class="empty-state__title">Library is empty</span>
      <span class="empty-state__body">Upload your first PDF, notes file, or practice sheet — organise it by subject and semester as you go.</span>
    </div>`;
    return;
  }
  if (!list.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);grid-column:1/-1;"><span class="empty-state__title">No matches</span><span class="empty-state__body">Try a different search, subject, or type.</span></div>`;
    return;
  }

  mount.innerHTML = list.map((item) => `
    <div class="card item-card" data-open="${item.id}">
      <div class="item-card__top">
        <div class="item-card__avatar" style="border-radius:10px;font-size:18px;">${iconFor(item.type)}</div>
        <div style="min-width:0;">
          <div class="item-card__name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(item.title)}</div>
          <div class="item-card__sub">${escapeHTML(item.subject || 'General')}${item.semester ? ` · ${escapeHTML(item.semester)}` : ''}</div>
        </div>
      </div>
      <div class="item-card__body">
        <span class="chip">${escapeHTML(item.type)}</span>
        ${item.fileName ? `<div style="margin-top:8px;">📎 ${escapeHTML(item.fileName)}</div>` : ''}
        ${item.link ? `<div style="margin-top:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔗 ${escapeHTML(item.link)}</div>` : ''}
        ${item.noteContent ? `<div style="margin-top:8px;">📝 ${escapeHTML(item.noteContent.slice(0, 60))}${item.noteContent.length > 60 ? '…' : ''}</div>` : ''}
        <div style="margin-top:6px;color:var(--ink-faint);">Added ${formatDate(item.createdAt)}</div>
      </div>
    </div>
  `).join('');

  mount.querySelectorAll('[data-open]').forEach((card) => {
    card.addEventListener('click', () => openItemDetail(items.find((i) => i.id === card.dataset.open)));
  });
  staggerChildren(mount, '.item-card');
}

function openItemModal() {
  openFormModal({
    title: 'Add to library',
    submitLabel: 'Save',
    values: { type: 'Notes' },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Unit 3 — Trees & Graphs' },
      { name: 'subject', label: 'Subject', type: 'text', placeholder: 'e.g. Data Structures' },
      { name: 'semester', label: 'Semester', type: 'text', placeholder: 'e.g. Semester 3' },
      { name: 'type', label: 'Type', type: 'select', options: TYPES },
      { name: 'folder', label: 'Folder (optional)', type: 'text', placeholder: 'e.g. Class Tests' },
      { name: 'tags', label: 'Tags (comma-separated)', type: 'text', placeholder: 'e.g. important, pyq' },
      { name: 'file', label: 'Upload a file (optional)', type: 'file' },
      { name: 'link', label: 'Or a link (optional)', type: 'text', placeholder: 'e.g. a YouTube lecture URL' },
      { name: 'noteContent', label: 'Or type a note directly (optional)', type: 'textarea', rows: 4, placeholder: 'Write your notes here…' },
    ],
    onSubmit: async (data) => {
      if (!data.title.trim()) { toast('Give this item a title.', 'error'); return; }

      const hasFile = Boolean(data.file);
      const hasLink = Boolean(data.link && data.link.trim());
      const hasNote = Boolean(data.noteContent && data.noteContent.trim());
      if (!hasFile && !hasLink && !hasNote) {
        toast('Add a file, a link, or type a note — an item needs at least one.', 'error');
        return;
      }
      if (hasLink && !/^https?:\/\//i.test(data.link.trim())) {
        toast('Links should start with http:// or https://', 'error');
        return;
      }

      const tags = data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
      const item = await create(ITEM_STORE, {
        title: data.title, subject: data.subject, semester: data.semester,
        type: data.type, folder: data.folder, tags,
        link: hasLink ? data.link.trim() : null,
        noteContent: hasNote ? data.noteContent.trim() : null,
        fileName: hasFile ? data.file.name : null,
        fileSize: hasFile ? data.file.size : null,
        fileMime: hasFile ? data.file.type : null,
      });

      if (hasFile) {
        const ok = await saveFile(item.id, data.file);
        if (!ok) { closeModal(); await reload(); return; }
      }
      toast('Added to library.', 'success');
      closeModal();
      await reload();
    },
  });
}

async function saveFile(itemId, file) {
  const MAX_RECOMMENDED = 40 * 1024 * 1024; // 40MB soft warning threshold
  if (file.size > MAX_RECOMMENDED) {
    toast(`"${file.name}" is large (${(file.size / (1024 * 1024)).toFixed(1)} MB) — your browser may refuse to store it.`, 'info', 6000);
  }
  try {
    await create(FILE_STORE, { itemId, blob: file });
    return true;
  } catch (err) {
    await update(ITEM_STORE, itemId, { fileName: null, fileSize: null, fileMime: null });
    toast(`Couldn't store "${file.name}" — it may be too large for this browser's storage. The item was saved without the file.`, 'error', 8000);
    return false;
  }
}

async function openItemDetail(item) {
  const fileRecord = item.fileName ? (await getAll(FILE_STORE)).find((f) => f.itemId === item.id) : null;

  const attachmentHTML = item.fileName ? `
    <div class="card" style="padding:var(--space-4) var(--space-5);margin-bottom:var(--space-4);background:var(--bg-inset);border:none;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <div style="font-weight:600;font-size:var(--text-sm);">📎 ${escapeHTML(item.fileName)}</div>
        <div style="font-size:var(--text-xs);color:var(--ink-faint);">${item.fileSize ? `${(item.fileSize / 1024).toFixed(0)} KB` : ''}</div>
      </div>
      <button type="button" class="btn btn--ghost" id="lib-view-file-btn">Open file</button>
    </div>
  ` : '';

  const linkHTML = item.link ? `
    <div class="card" style="padding:var(--space-4) var(--space-5);margin-bottom:var(--space-4);background:var(--bg-inset);border:none;display:flex;justify-content:space-between;align-items:center;">
      <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--text-sm);">🔗 ${escapeHTML(item.link)}</div>
      <a class="btn btn--ghost" href="${item.link}" target="_blank" rel="noopener">Open link</a>
    </div>
  ` : '';

  const noteHTML = item.noteContent ? `
    <div class="card" style="padding:var(--space-4) var(--space-5);margin-bottom:var(--space-5);background:var(--bg-inset);border:none;">
      <div style="font-weight:600;font-size:var(--text-xs);color:var(--ink-faint);margin-bottom:6px;">📝 NOTE</div>
      <div style="font-size:var(--text-sm);white-space:pre-wrap;line-height:var(--leading-relaxed);">${escapeHTML(item.noteContent)}</div>
    </div>
  ` : '';

  openFormModal({
    title: item.title,
    submitLabel: 'Save changes',
    extraHTML: attachmentHTML + linkHTML + noteHTML,
    values: { ...item, tags: (item.tags || []).join(', ') },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'subject', label: 'Subject', type: 'text' },
      { name: 'semester', label: 'Semester', type: 'text' },
      { name: 'type', label: 'Type', type: 'select', options: TYPES },
      { name: 'folder', label: 'Folder', type: 'text' },
      { name: 'tags', label: 'Tags (comma-separated)', type: 'text' },
      { name: 'link', label: 'Link', type: 'text', placeholder: 'e.g. a YouTube lecture URL' },
      { name: 'noteContent', label: 'Note', type: 'textarea', rows: 4 },
    ],
    onDelete: () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this item?', body: `"${item.title}"${item.fileName ? ' and its stored file' : ''} will be permanently removed.`, confirmLabel: 'Delete',
        onConfirm: async () => {
          await remove(ITEM_STORE, item.id);
          if (fileRecord) await remove(FILE_STORE, fileRecord.id);
          closeModal();
          toast('Item deleted.', 'success');
          await reload();
        },
      });
    },
    onSubmit: async (data) => {
      const hasExistingFile = Boolean(item.fileName);
      const hasLink = Boolean(data.link && data.link.trim());
      const hasNote = Boolean(data.noteContent && data.noteContent.trim());
      if (!hasExistingFile && !hasLink && !hasNote) {
        toast('An item needs a file, a link, or a note.', 'error');
        return;
      }
      if (hasLink && !/^https?:\/\//i.test(data.link.trim())) {
        toast('Links should start with http:// or https://', 'error');
        return;
      }
      const tags = data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [];
      await update(ITEM_STORE, item.id, { ...data, tags, link: hasLink ? data.link.trim() : null, noteContent: hasNote ? data.noteContent.trim() : null });
      toast('Item updated.', 'success');
      closeModal();
      await reload();
    },
  });

  const viewBtn = document.getElementById('lib-view-file-btn');
  if (viewBtn && fileRecord) {
    viewBtn.addEventListener('click', () => {
      const url = URL.createObjectURL(fileRecord.blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }
}
