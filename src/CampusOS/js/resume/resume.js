/**
 * resume.js — Resume Builder (Instructions 28–30). The whole profile is
 * one record (id: 'profile') so it can be built up gradually; nothing is
 * required. Achievements are read live from the Achievements store and
 * selected in, rather than re-entered (Instruction 29 — no duplicate
 * source of truth). PDF export uses the browser's native print-to-PDF
 * against a dedicated print stylesheet rather than a heavy client-side
 * PDF library, so there's no new dependency and no paid API.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getById, create, update, getAll } from '../core/db.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast } from '../core/notifications.js?v=5';
import { escapeHTML, formatDate, generateId } from '../core/utils.js?v=5';
import { validatePhone, validateEmail, validateNotFuture } from '../core/validators.js?v=5';

const STORE = CONFIG.stores.resume.name;
const PROFILE_ID = 'profile';
const ACH_STORE = CONFIG.stores.achievements.name;

let profile = null;
let achievements = [];

export async function initResume() {
  profile = await getById(STORE, PROFILE_ID);
  if (!profile) {
    profile = await create(STORE, {
      id: PROFILE_ID, personal: {}, online: {}, about: '', objective: '', interests: '',
      skills: [], languages: [], schools: [], education: [], projects: [], selectedAchievementIds: [],
    });
  }
  if (!profile.schools) profile.schools = []; // backfill for profiles created before this field existed
  if (!profile.customAchievements) profile.customAchievements = [];
  achievements = await getAll(ACH_STORE);

  bindSectionButtons();
  document.getElementById('resume-download-btn').addEventListener('click', downloadResumePdf);
  render();
}

/** Generates and directly downloads a real PDF using html2pdf.js (loaded
 * via CDN in resume.html) instead of the browser's print dialog. The
 * print-dialog approach doesn't give mobile browsers a way to produce a
 * downloadable file — many mobile browsers have no usable "print" UI at
 * all — so this renders the actual resume DOM to a PDF and triggers a
 * normal file download on every platform, phone included. */
async function downloadResumePdf() {
  const btn = document.getElementById('resume-download-btn');
  const source = document.getElementById('resume-doc');
  if (!source) { toast('Add something to your resume first.', 'error'); return; }
  if (typeof html2pdf === 'undefined') {
    toast('PDF generator failed to load — check your internet connection and try again.', 'error', 7000);
    return;
  }

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing PDF…';

  const filename = `${(profile.personal?.name || 'resume').trim().replace(/\s+/g, '-').toLowerCase()}.pdf`;

  try {
    await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css'] },
      })
      .from(source)
      .save();
  } catch (err) {
    console.error('PDF generation failed:', err);
    toast("Couldn't generate the PDF. Try again, or use your browser's print-to-PDF as a fallback.", 'error', 8000);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function save(patch) {
  profile = await update(STORE, PROFILE_ID, { ...profile, ...patch });
  render();
}

function bindSectionButtons() {
  document.getElementById('edit-personal-btn').addEventListener('click', editPersonal);
  document.getElementById('edit-online-btn').addEventListener('click', editOnline);
  document.getElementById('edit-about-btn').addEventListener('click', editAbout);
  document.getElementById('edit-skills-btn').addEventListener('click', editSkills);
  document.getElementById('edit-languages-btn').addEventListener('click', editLanguages);
  document.getElementById('add-school-btn').addEventListener('click', () => editSchool());
  document.getElementById('add-education-btn').addEventListener('click', () => editEducation());
  document.getElementById('add-project-btn').addEventListener('click', () => editProject());
  document.getElementById('add-custom-achievement-btn').addEventListener('click', () => editCustomAchievement());
  document.getElementById('edit-achievements-btn').addEventListener('click', editAchievementSelection);
}

// ---------- Section editors ----------

function editPersonal() {
  openFormModal({
    title: 'Personal details',
    values: profile.personal || {},
    fields: [
      { name: 'name', label: 'Full name', type: 'text' },
      { name: 'dob', label: 'Date of birth (optional)', type: 'date', max: new Date().toISOString().slice(0, 10) },
      { name: 'location', label: 'Location', type: 'text', placeholder: 'City, State' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
    ],
    onSubmit: async (data) => {
      const phoneError = validatePhone(data.phone);
      if (phoneError) { toast(phoneError, 'error'); return; }
      const emailError = validateEmail(data.email);
      if (emailError) { toast(emailError, 'error'); return; }
      const dobError = validateNotFuture(data.dob, 'Date of birth');
      if (dobError) { toast(dobError, 'error'); return; }
      await save({ personal: data });
      closeModal();
      toast('Saved.', 'success');
    },
  });
}

function editOnline() {
  openFormModal({
    title: 'Online profiles',
    values: profile.online || {},
    fields: [
      { name: 'github', label: 'GitHub', type: 'text', placeholder: 'github.com/username' },
      { name: 'linkedin', label: 'LinkedIn', type: 'text', placeholder: 'linkedin.com/in/username' },
      { name: 'portfolio', label: 'Portfolio', type: 'text' },
      { name: 'other', label: 'Other link', type: 'text' },
    ],
    onSubmit: async (data) => { await save({ online: data }); closeModal(); toast('Saved.', 'success'); },
  });
}

function editAbout() {
  openFormModal({
    title: 'Profile',
    values: { about: profile.about, objective: profile.objective, interests: profile.interests },
    fields: [
      { name: 'objective', label: 'Career / objective statement', type: 'textarea' },
      { name: 'about', label: 'About me', type: 'textarea' },
      { name: 'interests', label: 'Interests', type: 'text', placeholder: 'Comma-separated' },
    ],
    onSubmit: async (data) => { await save(data); closeModal(); toast('Saved.', 'success'); },
  });
}

function editSkills() {
  openFormModal({
    title: 'Skills',
    values: { skills: (profile.skills || []).join(', ') },
    fields: [{ name: 'skills', label: 'Skills (comma-separated)', type: 'textarea', placeholder: 'C++, Python, React, Git…' }],
    onSubmit: async (data) => {
      const skills = data.skills.split(',').map((s) => s.trim()).filter(Boolean);
      await save({ skills });
      closeModal();
      toast('Saved.', 'success');
    },
  });
}

function editLanguages() {
  openFormModal({
    title: 'Languages',
    values: { languages: (profile.languages || []).join(', ') },
    fields: [{ name: 'languages', label: 'Languages (comma-separated)', type: 'text', placeholder: 'English, Hindi, Gujarati…' }],
    onSubmit: async (data) => {
      const languages = data.languages.split(',').map((s) => s.trim()).filter(Boolean);
      await save({ languages });
      closeModal();
      toast('Saved.', 'success');
    },
  });
}

function editSchool(entry) {
  const isEdit = Boolean(entry);
  openFormModal({
    title: isEdit ? 'Edit school' : 'Add school',
    values: entry || {},
    fields: [
      { name: 'name', label: 'School name', type: 'text', required: true, placeholder: 'e.g. Delhi Public School' },
      { name: 'board', label: 'Board / Level', type: 'text', placeholder: 'e.g. CBSE — 12th Grade' },
      { name: 'yearCompleted', label: 'Year completed', type: 'number', min: 1980, max: new Date().getFullYear() },
      { name: 'percentage', label: 'Percentage / CGPA', type: 'text', placeholder: 'e.g. 92% or 9.4 CGPA' },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Remove this school?', body: '', confirmLabel: 'Remove',
        onConfirm: async () => {
          await save({ schools: (profile.schools || []).filter((s) => s.id !== entry.id) });
          closeModal();
        },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.name.trim()) { toast('Give the school a name.', 'error'); return; }
      const list = [...(profile.schools || [])];
      if (isEdit) { const i = list.findIndex((s) => s.id === entry.id); list[i] = { ...entry, ...data }; }
      else list.push({ id: generateId(), ...data });
      await save({ schools: list });
      closeModal();
      toast('Saved.', 'success');
    },
  });
}

function editEducation(entry) {
  const isEdit = Boolean(entry);
  openFormModal({
    title: isEdit ? 'Edit education' : 'Add education',
    values: entry || {},
    fields: [
      { name: 'college', label: 'College / Institute', type: 'text' },
      { name: 'degree', label: 'Degree', type: 'text', placeholder: 'e.g. B.Tech' },
      { name: 'branch', label: 'Branch', type: 'text', placeholder: 'e.g. Computer Engineering' },
      { name: 'semester', label: 'Semester / Year', type: 'text' },
      { name: 'notes', label: 'Notes (CGPA, honours, etc.)', type: 'text' },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Remove this education entry?', body: '', confirmLabel: 'Remove',
        onConfirm: async () => {
          await save({ education: (profile.education || []).filter((e) => e.id !== entry.id) });
          closeModal();
        },
      });
    } : undefined,
    onSubmit: async (data) => {
      const list = [...(profile.education || [])];
      if (isEdit) { const i = list.findIndex((e) => e.id === entry.id); list[i] = { ...entry, ...data }; }
      else list.push({ id: generateId(), ...data });
      await save({ education: list });
      closeModal();
      toast('Saved.', 'success');
    },
  });
}

function editProject(entry) {
  const isEdit = Boolean(entry);
  openFormModal({
    title: isEdit ? 'Edit project' : 'Add project',
    values: entry || {},
    fields: [
      { name: 'name', label: 'Project name', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'tech', label: 'Technologies (comma-separated)', type: 'text' },
      { name: 'link', label: 'Link', type: 'text' },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Remove this project?', body: '', confirmLabel: 'Remove',
        onConfirm: async () => {
          await save({ projects: (profile.projects || []).filter((p) => p.id !== entry.id) });
          closeModal();
        },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.name.trim()) { toast('Give the project a name.', 'error'); return; }
      const list = [...(profile.projects || [])];
      if (isEdit) { const i = list.findIndex((p) => p.id === entry.id); list[i] = { ...entry, ...data }; }
      else list.push({ id: generateId(), ...data });
      await save({ projects: list });
      closeModal();
      toast('Saved.', 'success');
    },
  });
}

function editCustomAchievement(entry) {
  const isEdit = Boolean(entry);
  openFormModal({
    title: isEdit ? 'Edit achievement' : 'Add achievement',
    values: entry || {},
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g. Best Paper Award' },
      { name: 'issuer', label: 'Issuing organization', type: 'text' },
      { name: 'date', label: 'Date', type: 'date', max: new Date().toISOString().slice(0, 10) },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Remove this achievement?', body: '', confirmLabel: 'Remove',
        onConfirm: async () => {
          await save({ customAchievements: (profile.customAchievements || []).filter((a) => a.id !== entry.id) });
          closeModal();
        },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.title.trim()) { toast('Give it a title.', 'error'); return; }
      const dateError = validateNotFuture(data.date, 'Date');
      if (dateError) { toast(dateError, 'error'); return; }
      const list = [...(profile.customAchievements || [])];
      if (isEdit) { const i = list.findIndex((a) => a.id === entry.id); list[i] = { ...entry, ...data }; }
      else list.push({ id: generateId(), ...data });
      await save({ customAchievements: list });
      closeModal();
      toast('Saved.', 'success');
    },
  });
}

function editAchievementSelection() {
  if (!achievements.length) {
    toast('No saved achievements in your vault yet — use "+ Add custom" instead, or add some in the Achievements module first.', 'info', 6000);
    return;
  }
  const selected = new Set(profile.selectedAchievementIds || []);
  const extraHTML = `
    <div style="max-height:320px;overflow-y:auto;margin-bottom:var(--space-4);">
      ${achievements.map((a) => `
        <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--surface-border);font-size:var(--text-sm);">
          <input type="checkbox" data-ach="${a.id}" ${selected.has(a.id) ? 'checked' : ''} style="width:auto;" />
          <span>${escapeHTML(a.title)}${a.issuer ? ` — ${escapeHTML(a.issuer)}` : ''}</span>
        </label>
      `).join('')}
    </div>
  `;
  openFormModal({
    title: 'Choose achievements to include',
    submitLabel: 'Save selection',
    extraHTML,
    fields: [],
    onSubmit: async () => {
      const checked = [...document.querySelectorAll('[data-ach]:checked')].map((el) => el.dataset.ach);
      await save({ selectedAchievementIds: checked });
      closeModal();
      toast('Resume updated.', 'success');
    },
  });
}

// ---------- Preview render ----------

function render() {
  renderCompleteness();
  renderEditorLists();
  renderPreview();
}

function renderEditorLists() {
  const schoolMount = document.getElementById('school-list');
  const eduMount = document.getElementById('education-list');
  const projMount = document.getElementById('project-list');

  schoolMount.innerHTML = (profile.schools || []).map((s) => `
    <div class="list-row card" data-edit-school="${s.id}" style="cursor:pointer;padding:var(--space-3) var(--space-4);">
      <div class="list-row__main">
        <div class="list-row__title">${escapeHTML(s.name || 'Untitled')}</div>
        <div class="list-row__meta"><span>${escapeHTML(s.board || '')}</span></div>
      </div>
    </div>
  `).join('');
  schoolMount.querySelectorAll('[data-edit-school]').forEach((row) => {
    row.addEventListener('click', () => editSchool(profile.schools.find((s) => s.id === row.dataset.editSchool)));
  });

  eduMount.innerHTML = (profile.education || []).map((e) => `
    <div class="list-row card" data-edit-edu="${e.id}" style="cursor:pointer;padding:var(--space-3) var(--space-4);">
      <div class="list-row__main">
        <div class="list-row__title">${escapeHTML(e.college || 'Untitled')}</div>
        <div class="list-row__meta"><span>${escapeHTML([e.degree, e.branch].filter(Boolean).join(', '))}</span></div>
      </div>
    </div>
  `).join('');
  eduMount.querySelectorAll('[data-edit-edu]').forEach((row) => {
    row.addEventListener('click', () => editEducation(profile.education.find((e) => e.id === row.dataset.editEdu)));
  });

  projMount.innerHTML = (profile.projects || []).map((pr) => `
    <div class="list-row card" data-edit-proj="${pr.id}" style="cursor:pointer;padding:var(--space-3) var(--space-4);">
      <div class="list-row__main">
        <div class="list-row__title">${escapeHTML(pr.name)}</div>
        <div class="list-row__meta"><span>${escapeHTML(pr.tech || '')}</span></div>
      </div>
    </div>
  `).join('');
  projMount.querySelectorAll('[data-edit-proj]').forEach((row) => {
    row.addEventListener('click', () => editProject(profile.projects.find((p) => p.id === row.dataset.editProj)));
  });

  const customAchMount = document.getElementById('custom-achievement-list');
  customAchMount.innerHTML = (profile.customAchievements || []).map((a) => `
    <div class="list-row card" data-edit-ca="${a.id}" style="cursor:pointer;padding:var(--space-3) var(--space-4);">
      <div class="list-row__main">
        <div class="list-row__title">${escapeHTML(a.title)}</div>
        <div class="list-row__meta"><span>${escapeHTML(a.issuer || '')}</span></div>
      </div>
    </div>
  `).join('');
  customAchMount.querySelectorAll('[data-edit-ca]').forEach((row) => {
    row.addEventListener('click', () => editCustomAchievement(profile.customAchievements.find((a) => a.id === row.dataset.editCa)));
  });
}

function renderCompleteness() {
  const fields = [
    profile.personal?.name, profile.personal?.email, profile.about, profile.objective,
    (profile.skills || []).length, (profile.education || []).length, (profile.projects || []).length,
  ];
  const filled = fields.filter(Boolean).length;
  const mount = document.getElementById('resume-progress-note');
  mount.textContent = filled === 0
    ? 'Start with your name and a project — you can build the rest over time.'
    : `${filled}/${fields.length} sections started.`;
}

const CONTACT_ICONS = {
  location: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>',
  email: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  github: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0012 2z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M6.94 5a2 2 0 11-4-.02 2 2 0 014 .02zM3.25 8.75h3.5V21h-3.5V8.75zm6.5 0h3.36v1.7h.05c.47-.87 1.6-1.79 3.3-1.79 3.53 0 4.18 2.32 4.18 5.34V21h-3.5v-5.85c0-1.4-.03-3.2-1.95-3.2-1.95 0-2.25 1.52-2.25 3.09V21h-3.5V8.75z"/></svg>',
  link: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.07 0l2-2a5 5 0 00-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 00-7.07 0l-2 2a5 5 0 007.07 7.07l1-1"/></svg>',
};

function contactChip(iconKey, text) {
  if (!text) return '';
  return `<span class="r-contact__item">${CONTACT_ICONS[iconKey]}${escapeHTML(text)}</span>`;
}

function renderPreview() {
  const mount = document.getElementById('resume-preview');
  const p = profile;
  const hasAnything = p.personal?.name || p.about || (p.skills || []).length || (p.schools || []).length || (p.education || []).length || (p.projects || []).length || (p.customAchievements || []).length || (p.selectedAchievementIds || []).length;

  if (!hasAnything) {
    mount.innerHTML = `<div class="empty-state" style="padding:var(--space-8);"><span class="empty-state__title">Nothing to preview yet</span><span class="empty-state__body">Start with your name on the left and it'll appear here, formatted for a resume.</span></div>`;
    return;
  }

  const selectedAch = achievements.filter((a) => (p.selectedAchievementIds || []).includes(a.id))
    .map((a) => ({ title: a.title, issuer: a.issuer, date: a.date }));
  const customAch = (p.customAchievements || []).map((a) => ({ title: a.title, issuer: a.issuer, date: a.date }));
  const allAch = [...selectedAch, ...customAch].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const contactRow = [
    contactChip('location', p.personal?.location),
    contactChip('phone', p.personal?.phone),
    contactChip('email', p.personal?.email),
    contactChip('github', p.online?.github),
    contactChip('linkedin', p.online?.linkedin),
    contactChip('link', p.online?.portfolio),
    contactChip('link', p.online?.other),
  ].filter(Boolean).join('');

  const headline = p.education?.[0] ? [p.education[0].degree, p.education[0].branch].filter(Boolean).join(', ') : '';

  mount.innerHTML = `
    <div id="resume-doc">
      <div class="r-header">
        <h1 class="r-name">${p.personal?.name ? escapeHTML(p.personal.name) : 'Your Name'}</h1>
        ${headline ? `<div class="r-tagline">${escapeHTML(headline)}</div>` : ''}
        ${contactRow ? `<div class="r-contact">${contactRow}</div>` : '<div class="r-contact r-contact--empty">Add your contact details from the panel on the left.</div>'}
      </div>

      ${p.objective ? `<section class="r-section"><h2>Objective</h2><p>${escapeHTML(p.objective)}</p></section>` : ''}
      ${p.about ? `<section class="r-section"><h2>About</h2><p>${escapeHTML(p.about)}</p></section>` : ''}

      ${(p.education || []).length ? `<section class="r-section"><h2>Education</h2>
        ${p.education.map((e) => `<div class="r-item">
          <div class="r-item__row"><strong>${escapeHTML(e.college || '')}</strong><span>${escapeHTML(e.semester || '')}</span></div>
          <div class="r-item__sub">${[e.degree, e.branch].filter(Boolean).map(escapeHTML).join(', ')}${e.notes ? ` · ${escapeHTML(e.notes)}` : ''}</div>
        </div>`).join('')}
      </section>` : ''}

      ${(p.schools || []).length ? `<section class="r-section"><h2>Schooling</h2>
        ${p.schools.map((s) => `<div class="r-item">
          <div class="r-item__row"><strong>${escapeHTML(s.name)}</strong><span>${escapeHTML(s.yearCompleted || '')}</span></div>
          <div class="r-item__sub">${[s.board, s.percentage].filter(Boolean).map(escapeHTML).join(' · ')}</div>
        </div>`).join('')}
      </section>` : ''}

      ${(p.projects || []).length ? `<section class="r-section"><h2>Projects</h2>
        ${p.projects.map((pr) => `<div class="r-item">
          <div class="r-item__row"><strong>${escapeHTML(pr.name)}</strong>${pr.link ? `<span>${escapeHTML(pr.link)}</span>` : ''}</div>
          ${pr.tech ? `<div class="r-item__sub">${escapeHTML(pr.tech)}</div>` : ''}
          ${pr.description ? `<p>${escapeHTML(pr.description)}</p>` : ''}
        </div>`).join('')}
      </section>` : ''}

      ${(p.skills || []).length ? `<section class="r-section"><h2>Skills</h2><div class="r-tags">${p.skills.map((s) => `<span class="r-tag">${escapeHTML(s)}</span>`).join('')}</div></section>` : ''}

      ${allAch.length ? `<section class="r-section"><h2>Achievements</h2>
        ${allAch.map((a) => `<div class="r-item">
          <div class="r-item__row"><strong>${escapeHTML(a.title)}</strong>${a.date ? `<span>${formatDate(a.date)}</span>` : ''}</div>
          ${a.issuer ? `<div class="r-item__sub">${escapeHTML(a.issuer)}</div>` : ''}
        </div>`).join('')}
      </section>` : ''}

      ${(p.languages || []).length ? `<section class="r-section"><h2>Languages</h2><div class="r-tags">${p.languages.map((l) => `<span class="r-tag">${escapeHTML(l)}</span>`).join('')}</div></section>` : ''}
      ${p.interests ? `<section class="r-section"><h2>Interests</h2><p>${escapeHTML(p.interests)}</p></section>` : ''}
    </div>
  `;
}
