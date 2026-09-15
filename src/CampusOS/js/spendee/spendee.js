/**
 * spendee.js — personal finance (Instruction 8) + money-owed tracker
 * (Instruction 9). Debts always keep their original amount plus a
 * repayments[] history; remaining balance is derived, never overwritten.
 */

import { CONFIG } from '../core/config.js?v=5';
import { getAll, create, update, remove } from '../core/db.js?v=5';
import { ensureCategories, addCategory } from '../core/categories.js?v=5';
import { openFormModal, openConfirmModal, closeModal } from '../core/modal.js?v=5';
import { toast } from '../core/notifications.js?v=5';
import { formatDate, formatCurrency, escapeHTML, debounce, nowISO, generateId, categoryColor, staggerChildren } from '../core/utils.js?v=5';
import { getDeepLinkId } from '../core/search.js?v=5';

const TX_STORE = CONFIG.stores.transactions.name;
const DEBT_STORE = CONFIG.stores.debts.name;
const CAT_STORE = CONFIG.stores.spendeeCategories.name;

let transactions = [];
let debts = [];
let categories = [];
let tab = 'overview';
let txState = { search: '', type: 'all', category: 'all' };
let debtState = { direction: 'all', settled: 'unsettled' };

export async function initSpendee() {
  categories = await ensureCategories(CAT_STORE, CONFIG.defaults.spendeeCategories);
  await reload();
  bindTabs();
  bindTransactionToolbar();
  bindDebtToolbar();
  document.getElementById('tx-add-btn').addEventListener('click', () => openTransactionModal());
  document.getElementById('debt-add-btn').addEventListener('click', () => openDebtModal());
  document.getElementById('tx-add-category-btn').addEventListener('click', () => {
    openFormModal({
      title: 'New spending category',
      submitLabel: 'Add category',
      fields: [{ name: 'name', label: 'Category name', type: 'text', required: true, placeholder: 'e.g. Subscriptions' }],
      onSubmit: async (data) => {
        if (!data.name.trim()) { toast('Give the category a name.', 'error'); return; }
        await addCategory(CAT_STORE, data.name);
        categories = await getAll(CAT_STORE);
        populateCategorySelect(document.getElementById('tx-filter-category'));
        toast('Category added.', 'success');
        closeModal();
      },
    });
  });

  const openId = getDeepLinkId();
  if (openId) {
    const tx = transactions.find((t) => t.id === openId);
    const debt = debts.find((d) => d.id === openId);
    if (tx) { document.querySelector('[data-tab="transactions"]').click(); openTransactionModal(tx); }
    else if (debt) { document.querySelector('[data-tab="debts"]').click(); openDebtDetail(debt); }
  }
}

async function reload() {
  [transactions, debts] = await Promise.all([getAll(TX_STORE), getAll(DEBT_STORE)]);
  renderAll();
}

function bindTabs() {
  document.querySelectorAll('.tab[data-tab]').forEach((t) => {
    t.addEventListener('click', () => {
      tab = t.dataset.tab;
      document.querySelectorAll('.tab[data-tab]').forEach((x) => x.classList.toggle('is-active', x === t));
      document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    });
  });
}

function bindTransactionToolbar() {
  document.getElementById('tx-search').addEventListener('input', debounce((e) => {
    txState.search = e.target.value.trim().toLowerCase();
    renderTransactions();
  }, 200));
  document.getElementById('tx-filter-type').addEventListener('change', (e) => { txState.type = e.target.value; renderTransactions(); });
  const catSelect = document.getElementById('tx-filter-category');
  populateCategorySelect(catSelect);
  catSelect.addEventListener('change', (e) => { txState.category = e.target.value; renderTransactions(); });
}

function bindDebtToolbar() {
  document.getElementById('debt-filter-direction').addEventListener('change', (e) => { debtState.direction = e.target.value; renderDebts(); });
  document.getElementById('debt-filter-settled').addEventListener('change', (e) => { debtState.settled = e.target.value; renderDebts(); });
}

function populateCategorySelect(select) {
  select.innerHTML = `<option value="all">All categories</option>` +
    categories.map((c) => `<option value="${escapeHTML(c.name)}">${escapeHTML(c.name)}</option>`).join('');
}

function remainingBalance(debt) {
  const repaid = (debt.repayments || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return Math.max(0, Number(debt.amount || 0) - repaid);
}

function renderAll() {
  renderOverview();
  renderTransactions();
  renderDebts();
  renderBudgets();
}

/** Budgets live as a `monthlyBudget` field directly on each spending
 * category record (0/undefined = no budget set), so there's no separate
 * store to keep in sync — set once per category, compared against this
 * calendar month's actual spend every time the tab renders. */
function renderBudgets() {
  const mount = document.getElementById('budget-list');
  if (!mount) return;

  const thisMonth = new Date().getMonth();
  const thisYear = new Date().getFullYear();
  const spentByCategory = {};
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    const d = new Date(t.date);
    if (d.getMonth() !== thisMonth || d.getFullYear() !== thisYear) continue;
    spentByCategory[t.category] = (spentByCategory[t.category] || 0) + Number(t.amount);
  }

  const withBudget = categories.filter((c) => c.monthlyBudget > 0);
  const withoutBudget = categories.filter((c) => !(c.monthlyBudget > 0));

  if (!categories.length) { mount.innerHTML = ''; return; }

  mount.innerHTML = `
    ${withBudget.length ? withBudget.map((c) => {
      const spent = spentByCategory[c.name] || 0;
      const pct = Math.min(100, (spent / c.monthlyBudget) * 100);
      const over = spent > c.monthlyBudget;
      return `
        <div class="card" style="padding:var(--space-5);cursor:pointer;" data-edit-budget="${c.id}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="width:9px;height:9px;border-radius:50%;background:${categoryColor(c.name)};"></span>
              <span style="font-weight:600;font-size:var(--text-sm);">${escapeHTML(c.name)}</span>
            </div>
            <span style="font-size:var(--text-sm);color:${over ? 'var(--danger)' : 'var(--ink-faint)'}">${formatCurrency(spent)} / ${formatCurrency(c.monthlyBudget)}</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${over ? 'var(--danger)' : pct > 80 ? 'var(--accent)' : 'var(--success)'};"></div></div>
          ${over ? `<div style="font-size:var(--text-xs);color:var(--danger);margin-top:6px;">Over budget by ${formatCurrency(spent - c.monthlyBudget)} this month.</div>` : ''}
        </div>
      `;
    }).join('') : `<div class="card empty-state" style="padding:var(--space-6);"><span class="empty-state__title">No budgets set yet</span><span class="empty-state__body">Set a monthly limit on a category below to start tracking against it.</span></div>`}

    ${withoutBudget.length ? `
      <div class="section-title">Set a budget</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${withoutBudget.map((c) => `<button class="chip" style="cursor:pointer;" data-edit-budget="${c.id}">+ ${escapeHTML(c.name)}</button>`).join('')}
      </div>
    ` : ''}
  `;

  mount.querySelectorAll('[data-edit-budget]').forEach((el) => {
    el.addEventListener('click', () => openBudgetModal(categories.find((c) => c.id === el.dataset.editBudget)));
  });
  staggerChildren(mount, '.card');
}

function openBudgetModal(category) {
  openFormModal({
    title: `Monthly budget — ${category.name}`,
    submitLabel: 'Save budget',
    values: { monthlyBudget: category.monthlyBudget || '' },
    fields: [
      { name: 'monthlyBudget', label: 'Monthly limit (₹, 0 to remove)', type: 'number', min: 0, step: '1' },
    ],
    onSubmit: async (data) => {
      const amount = Number(data.monthlyBudget) || 0;
      await update(CAT_STORE, category.id, { monthlyBudget: amount });
      categories = await getAll(CAT_STORE);
      closeModal();
      toast(amount > 0 ? 'Budget saved.' : 'Budget removed.', 'success');
      renderBudgets();
    },
  });
}

/** Recurring transactions have no separate store — a transaction just
 * carries `recurring: 'monthly'`. "Due" means a month has passed since
 * the most recent transaction with the same description+category+type
 * combination, so re-logging it takes one click instead of re-entering
 * everything. */
function dueRecurringTransactions() {
  const recurring = transactions.filter((t) => t.recurring === 'monthly');
  const groups = {};
  for (const t of recurring) {
    const key = `${t.type}|${t.category}|${t.description || ''}`;
    if (!groups[key] || new Date(t.date) > new Date(groups[key].date)) groups[key] = t;
  }
  const today = new Date();
  return Object.values(groups).filter((t) => {
    const next = new Date(t.date);
    next.setMonth(next.getMonth() + 1);
    return next <= today;
  });
}

function renderRecurringReminders() {
  const due = dueRecurringTransactions();
  if (!due.length) return '';
  return `
    <div class="card" style="padding:var(--space-5);margin-bottom:var(--space-6);border-color:var(--accent);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
        <span>🔁</span><strong style="font-size:var(--text-sm);">Recurring — due to log again</strong>
      </div>
      ${due.map((t) => `
        <div class="money-line">
          <span>${escapeHTML(t.description || t.category)} <span style="color:var(--ink-faint);">(${escapeHTML(t.category)})</span></span>
          <div style="display:flex;align-items:center;gap:10px;">
            <strong>${formatCurrency(t.amount)}</strong>
            <button class="btn btn--ghost" data-log-recurring="${t.id}" style="padding:4px 10px;font-size:var(--text-xs);">Log again</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOverview() {
  const mount = document.getElementById('spendee-overview');
  if (!transactions.length && !debts.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);">
      <span class="empty-state__title">Nothing tracked yet</span>
      <span class="empty-state__body">Log your first expense, income, or a debt with a friend to see your money picture here.</span>
    </div>`;
    return;
  }
  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const owedToMe = debts.filter((d) => d.direction === 'owed_to_me').reduce((s, d) => s + remainingBalance(d), 0);
  const owedByMe = debts.filter((d) => d.direction === 'i_owe').reduce((s, d) => s + remainingBalance(d), 0);
  const net = income - expense;

  const byCategory = {};
  for (const t of transactions.filter((t) => t.type === 'expense')) {
    byCategory[t.category] = (byCategory[t.category] || 0) + Number(t.amount);
  }
  const catEntries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);

  mount.innerHTML = `
    ${renderRecurringReminders()}
    <div class="stat-strip">
      <div class="card stat-card">
        <div class="stat-card__label">Net this period</div>
        <div class="stat-card__value" style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${net >= 0 ? '+' : '−'}${formatCurrency(Math.abs(net))}</div>
        <div style="font-size:var(--text-xs);color:var(--ink-faint);margin-top:2px;">income minus spending</div>
      </div>
      <div class="card stat-card"><div class="stat-card__label">Total income</div><div class="stat-card__value" style="color:var(--success)">${formatCurrency(income)}</div></div>
      <div class="card stat-card"><div class="stat-card__label">Total spent</div><div class="stat-card__value" style="color:var(--danger)">${formatCurrency(expense)}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:var(--space-4);margin-bottom:var(--space-6);">
      <div class="card" style="padding:var(--space-4) var(--space-5);display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-weight:600;font-size:var(--text-sm);">Owed to me</div><div style="font-size:var(--text-xs);color:var(--ink-faint);">Friends who owe you</div></div>
        <strong style="color:var(--success);font-family:var(--font-display);font-size:var(--text-lg);">${formatCurrency(owedToMe)}</strong>
      </div>
      <div class="card" style="padding:var(--space-4) var(--space-5);display:flex;justify-content:space-between;align-items:center;">
        <div><div style="font-weight:600;font-size:var(--text-sm);">I owe</div><div style="font-size:var(--text-xs);color:var(--ink-faint);">What you still need to pay back</div></div>
        <strong style="color:var(--danger);font-family:var(--font-display);font-size:var(--text-lg);">${formatCurrency(owedByMe)}</strong>
      </div>
    </div>

    ${catEntries.length ? `
    <div class="card" style="padding:var(--space-6);margin-bottom:var(--space-6);">
      <div class="section-title" style="margin-top:0;">Where your money goes</div>
      <div style="display:flex;gap:var(--space-8);flex-wrap:wrap;align-items:center;">
        ${donutSVG(catEntries)}
        <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:8px;">
          ${catEntries.map(([cat, amt]) => `
            <div style="display:flex;align-items:center;gap:10px;font-size:var(--text-sm);">
              <span style="width:10px;height:10px;border-radius:50%;background:${categoryColor(cat)};flex-shrink:0;"></span>
              <span style="flex:1;">${escapeHTML(cat)}</span>
              <strong>${formatCurrency(amt)}</strong>
              <span style="color:var(--ink-faint);font-size:var(--text-xs);width:42px;text-align:right;">${((amt / expense) * 100).toFixed(0)}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>` : ''}

    ${monthlyTrend().hasData ? `
    <div class="card" style="padding:var(--space-6);">
      <div class="section-title" style="margin-top:0;">Last 6 months</div>
      ${trendChartSVG(monthlyTrend())}
    </div>` : ''}
  `;

  mount.querySelectorAll('[data-log-recurring]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const original = transactions.find((t) => t.id === btn.dataset.logRecurring);
      if (!original) return;
      openTransactionModal(null, {
        type: original.type, amount: original.amount, category: original.category,
        date: new Date().toISOString().slice(0, 10), description: original.description,
        paymentMethod: original.paymentMethod, recurring: original.recurring,
      });
    });
  });
}

/** SVG donut chart built from category totals — no charting dependency. */
function donutSVG(entries) {
  const total = entries.reduce((s, [, amt]) => s + amt, 0);
  const size = 160;
  const r = 60;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const arcs = entries.map(([cat, amt]) => {
    const fraction = amt / total;
    const dash = fraction * circumference;
    const circle = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${categoryColor(cat)}"
      stroke-width="22" stroke-dasharray="${dash} ${circumference - dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cy})" />`;
    offset += dash;
    return circle;
  }).join('');

  return `
    <svg viewBox="0 0 ${size} ${size}" style="width:160px;height:160px;flex-shrink:0;" role="img" aria-label="Spending by category">
      ${arcs}
      <circle cx="${cx}" cy="${cy}" r="${r - 15}" fill="var(--surface)" />
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="10" fill="var(--ink-faint)">Total</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--ink)">${formatCurrency(total).replace('.00', '')}</text>
    </svg>
  `;
}

/** Buckets transactions into the last 6 calendar months for a simple
 * income-vs-expense trend chart. */
function monthlyTrend() {
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-IN', { month: 'short' }), income: 0, expense: 0 });
  }
  let hasData = false;
  for (const t of transactions) {
    const d = new Date(t.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const bucket = months.find((m) => m.key === key);
    if (!bucket) continue;
    hasData = true;
    if (t.type === 'income') bucket.income += Number(t.amount);
    else bucket.expense += Number(t.amount);
  }
  return { months, hasData };
}

function trendChartSVG({ months }) {
  const w = 560, h = 160, pad = 24;
  const max = Math.max(1, ...months.map((m) => Math.max(m.income, m.expense)));
  const barW = (w - pad * 2) / (months.length * 2.4);

  const bars = months.map((m, i) => {
    const groupX = pad + i * ((w - pad * 2) / months.length);
    const incomeH = (m.income / max) * (h - 40);
    const expenseH = (m.expense / max) * (h - 40);
    return `
      <rect x="${groupX}" y="${h - 24 - incomeH}" width="${barW}" height="${incomeH}" fill="var(--success)" rx="2" />
      <rect x="${groupX + barW + 4}" y="${h - 24 - expenseH}" width="${barW}" height="${expenseH}" fill="var(--danger)" rx="2" />
      <text x="${groupX + barW}" y="${h - 8}" font-size="10" fill="var(--ink-faint)" text-anchor="middle">${m.label}</text>
    `;
  }).join('');

  return `
    <div style="display:flex;gap:var(--space-5);align-items:center;margin-bottom:var(--space-2);font-size:var(--text-xs);color:var(--ink-faint);">
      <span style="display:flex;align-items:center;gap:6px;"><span style="width:9px;height:9px;border-radius:2px;background:var(--success);display:inline-block;"></span>Income</span>
      <span style="display:flex;align-items:center;gap:6px;"><span style="width:9px;height:9px;border-radius:2px;background:var(--danger);display:inline-block;"></span>Expense</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:560px;display:block;" role="img" aria-label="Income and expense over the last 6 months">
      ${bars}
    </svg>
  `;
}

function renderTransactions() {
  const mount = document.getElementById('tx-list');
  let list = [...transactions];
  if (txState.search) list = list.filter((t) => (t.description || '').toLowerCase().includes(txState.search) || (t.category || '').toLowerCase().includes(txState.search));
  if (txState.type !== 'all') list = list.filter((t) => t.type === txState.type);
  if (txState.category !== 'all') list = list.filter((t) => t.category === txState.category);
  list.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!transactions.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);"><span class="empty-state__title">No transactions yet</span><span class="empty-state__body">Log an expense or income to start building your history.</span></div>`;
    return;
  }
  if (!list.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);"><span class="empty-state__title">Nothing matches</span><span class="empty-state__body">Try a different search or filter.</span></div>`;
    return;
  }

  mount.innerHTML = list.map((t) => `
    <div class="card list-row" data-open="${t.id}" style="cursor:pointer;">
      <span style="width:10px;height:10px;border-radius:50%;background:${t.type === 'income' ? 'var(--success)' : categoryColor(t.category)};flex-shrink:0;"></span>
      <div class="list-row__main">
        <div class="list-row__title">${escapeHTML(t.description || t.category)}</div>
        <div class="list-row__meta">
          <span>${escapeHTML(t.category)}</span>
          <span>${formatDate(t.date)}</span>
          ${t.paymentMethod ? `<span>${escapeHTML(t.paymentMethod)}</span>` : ''}
          ${t.recurring ? '<span>🔁 Monthly</span>' : ''}
        </div>
      </div>
      <strong style="color:${t.type === 'income' ? 'var(--success)' : 'var(--danger)'}">${t.type === 'income' ? '+' : '−'}${formatCurrency(t.amount)}</strong>
    </div>
  `).join('');

  mount.querySelectorAll('[data-open]').forEach((row) => {
    row.addEventListener('click', () => openTransactionModal(transactions.find((t) => t.id === row.dataset.open)));
  });
  staggerChildren(mount, '.list-row');
}

function openTransactionModal(tx, presetValues) {
  const isEdit = Boolean(tx);
  const values = presetValues || tx || { type: 'expense', date: new Date().toISOString().slice(0, 10), category: categories[0]?.name || '' };

  openFormModal({
    title: isEdit ? 'Edit transaction' : 'New transaction',
    submitLabel: isEdit ? 'Save changes' : 'Add transaction',
    values,
    fields: [
      { name: 'type', label: 'Type', type: 'select', options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, step: '0.01', required: true },
      { name: 'category', label: 'Category', type: 'select', options: [...categories.map((c) => c.name), { value: '__new__', label: '+ Add custom category…' }] },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'description', label: 'Note', type: 'text', placeholder: 'e.g. Canteen lunch' },
      { name: 'paymentMethod', label: 'Payment method', type: 'select', options: ['', 'Cash', 'UPI', 'Card', 'Other'] },
      { name: 'recurring', label: 'Repeats', type: 'select', options: [
        { value: '', label: 'One-time' },
        { value: 'monthly', label: 'Monthly (e.g. rent, allowance)' },
      ] },
    ],
    onDelete: isEdit ? () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this transaction?', body: 'This cannot be undone.', confirmLabel: 'Delete',
        onConfirm: async () => { await remove(TX_STORE, tx.id); closeModal(); toast('Transaction deleted.', 'success'); await reload(); },
      });
    } : undefined,
    onSubmit: async (data) => {
      if (!data.amount || data.amount <= 0) { toast('Enter an amount greater than zero.', 'error'); return; }
      if (isEdit) { await update(TX_STORE, tx.id, data); toast('Transaction updated.', 'success'); }
      else { await create(TX_STORE, data); toast('Transaction added.', 'success'); }
      closeModal();
      await reload();
    },
  });

  // Inline "+ Add custom category" — capture the rest of the form,
  // swap to a tiny category-name modal, then reopen this same
  // transaction modal pre-filled with everything plus the new category.
  const catSelect = document.getElementById('f_category');
  catSelect.addEventListener('change', (e) => {
    if (e.target.value !== '__new__') return;
    const form = catSelect.closest('form');
    const snapshot = {
      type: form.elements.type.value,
      amount: form.elements.amount.value,
      date: form.elements.date.value,
      description: form.elements.description.value,
      paymentMethod: form.elements.paymentMethod.value,
    };
    openFormModal({
      title: 'New spending category',
      submitLabel: 'Add category',
      fields: [{ name: 'name', label: 'Category name', type: 'text', required: true, placeholder: 'e.g. Subscriptions' }],
      onSubmit: async (catData) => {
        if (!catData.name.trim()) { toast('Give the category a name.', 'error'); return; }
        const cat = await addCategory(CAT_STORE, catData.name);
        categories = await getAll(CAT_STORE);
        populateCategorySelect(document.getElementById('tx-filter-category'));
        closeModal();
        openTransactionModal(tx, { ...snapshot, category: cat.name });
      },
    });
  });
}

// ---------------- Debts ----------------

function renderDebts() {
  const mount = document.getElementById('debt-list');
  let list = [...debts];
  if (debtState.direction !== 'all') list = list.filter((d) => d.direction === debtState.direction);
  if (debtState.settled === 'unsettled') list = list.filter((d) => !d.settled);
  if (debtState.settled === 'settled') list = list.filter((d) => d.settled);
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (!debts.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);"><span class="empty-state__title">No debts tracked</span><span class="empty-state__body">Add money someone owes you, or money you owe a friend, and CampusOS will track partial repayments automatically.</span></div>`;
    return;
  }
  if (!list.length) {
    mount.innerHTML = `<div class="card empty-state" style="padding:var(--space-8);"><span class="empty-state__title">Nothing here</span><span class="empty-state__body">No debts match this filter.</span></div>`;
    return;
  }

  mount.innerHTML = list.map((d) => {
    const remaining = remainingBalance(d);
    const pct = d.amount ? Math.min(100, ((d.amount - remaining) / d.amount) * 100) : 0;
    const owedToMe = d.direction === 'owed_to_me';
    return `
      <div class="card" style="padding:var(--space-5);cursor:pointer;" data-open="${d.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:var(--space-3);">
          <div>
            <div style="font-weight:600;font-size:var(--text-sm);">${escapeHTML(d.person)}</div>
            <div style="font-size:var(--text-xs);color:var(--ink-faint);margin-top:2px;">${owedToMe ? 'Owes you' : 'You owe'} · ${d.settled ? 'Settled' : `${formatCurrency(remaining)} remaining of ${formatCurrency(d.amount)}`}</div>
          </div>
          <span class="badge ${d.settled ? 'badge--success' : (owedToMe ? 'badge--info' : 'badge--danger')}">${d.settled ? 'Settled' : owedToMe ? 'Owed to you' : 'You owe'}</span>
        </div>
        ${!d.settled ? `<div class="progress-track" style="margin-top:var(--space-3);"><div class="progress-fill" style="width:${pct}%;background:${owedToMe ? 'var(--success)' : 'var(--danger)'};"></div></div>` : ''}
      </div>
    `;
  }).join('');

  mount.querySelectorAll('[data-open]').forEach((card) => {
    card.addEventListener('click', () => openDebtDetail(debts.find((d) => d.id === card.dataset.open)));
  });
  staggerChildren(mount, ':scope > .card');
}

function openDebtModal() {
  openFormModal({
    title: 'Add a debt',
    submitLabel: 'Add debt',
    values: { direction: 'owed_to_me', date: new Date().toISOString().slice(0, 10) },
    fields: [
      { name: 'person', label: 'Person', type: 'text', required: true, placeholder: 'e.g. Rohit' },
      { name: 'direction', label: 'Direction', type: 'select', options: [{ value: 'owed_to_me', label: 'They owe me' }, { value: 'i_owe', label: 'I owe them' }] },
      { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, step: '0.01', required: true },
      { name: 'date', label: 'Date', type: 'date' },
      { name: 'notes', label: 'Notes', type: 'textarea', placeholder: 'What was this for?' },
    ],
    onSubmit: async (data) => {
      if (!data.person.trim()) { toast('Add who this debt is with.', 'error'); return; }
      if (!data.amount || data.amount <= 0) { toast('Enter an amount greater than zero.', 'error'); return; }
      await create(DEBT_STORE, { ...data, repayments: [], settled: false });
      toast('Debt added.', 'success');
      closeModal();
      await reload();
    },
  });
}

/** Detail view for one debt: full repayment history, add-repayment,
 * settle, edit, delete. This is deliberately its own modal rather than
 * folded into the add/edit form, since the history table needs room. */
function openDebtDetail(debt) {
  const remaining = remainingBalance(debt);
  const historyRows = (debt.repayments || []).slice().reverse().map((r) => `
    <div class="money-line"><span>${formatDate(r.date)}</span><strong>${formatCurrency(r.amount)}</strong></div>
  `).join('') || '<p style="font-size:var(--text-xs);color:var(--ink-faint);">No repayments recorded yet.</p>';

  const extraHTML = `
    <div class="card" style="padding:var(--space-4) var(--space-5);margin-bottom:var(--space-5);background:var(--bg-inset);border:none;">
      <div class="money-line" style="border-top:none;"><span>Original amount</span><strong>${formatCurrency(debt.amount)}</strong></div>
      <div class="money-line"><span>Repaid</span><strong>${formatCurrency(debt.amount - remaining)}</strong></div>
      <div class="money-line"><span>Remaining</span><strong style="color:${remaining > 0 ? 'var(--danger)' : 'var(--success)'}">${formatCurrency(remaining)}</strong></div>
    </div>
    <div class="section-title" style="margin-top:0;">Repayment history</div>
    <div style="margin-bottom:var(--space-5);">${historyRows}</div>
    ${!debt.settled && remaining > 0 ? `
    <div class="field">
      <label>Record a repayment (₹)</label>
      <div style="display:flex;gap:8px;">
        <input type="number" id="repay-amount" min="0" max="${remaining}" step="0.01" placeholder="Amount" style="flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--surface-border);background:var(--surface);" />
        <button type="button" class="btn btn--primary" id="repay-btn">Add</button>
      </div>
    </div>` : ''}
  `;

  openFormModal({
    title: `${debt.person} — ${debt.direction === 'owed_to_me' ? 'owes you' : 'you owe'}`,
    submitLabel: debt.settled ? 'Reopen debt' : 'Mark settled',
    extraHTML,
    fields: [],
    onDelete: () => {
      closeModal();
      openConfirmModal({
        title: 'Delete this debt?', body: 'The full repayment history will be lost. This cannot be undone.', confirmLabel: 'Delete',
        onConfirm: async () => { await remove(DEBT_STORE, debt.id); closeModal(); toast('Debt deleted.', 'success'); await reload(); },
      });
    },
    onSubmit: async () => {
      await update(DEBT_STORE, debt.id, { settled: !debt.settled });
      toast(debt.settled ? 'Debt reopened.' : 'Debt marked settled.', 'success');
      closeModal();
      await reload();
    },
  });

  const repayBtn = document.getElementById('repay-btn');
  if (repayBtn) {
    repayBtn.addEventListener('click', async () => {
      const input = document.getElementById('repay-amount');
      const amt = Number(input.value);
      if (!amt || amt <= 0) { toast('Enter a repayment amount.', 'error'); return; }
      if (amt > remaining) { toast(`Repayment can't exceed the remaining ${formatCurrency(remaining)}.`, 'error'); return; }
      const repayments = [...(debt.repayments || []), { id: generateId(), amount: amt, date: nowISO() }];
      const newRemaining = remainingBalance({ ...debt, repayments });
      await update(DEBT_STORE, debt.id, { repayments, settled: newRemaining <= 0 });
      toast('Repayment recorded.', 'success');
      closeModal();
      await reload();
    });
  }
}
