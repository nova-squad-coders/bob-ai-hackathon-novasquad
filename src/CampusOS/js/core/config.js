/**
 * config.js
 * Single source of truth for app-wide configuration:
 *  - product name (not hard-coded elsewhere, see spec Note 1)
 *  - IndexedDB schema (name, version, object stores, indexes)
 *  - the module registry (what exists, what's coming, its nav icon/route)
 *  - shared default categories (all are user-editable at runtime; these are
 *    just the seed values used the first time a store is created)
 *
 * Nothing outside core/ should hard-code a store name or a magic string that
 * belongs here. If you're about to type 'tasks' as a literal somewhere new,
 * import CONFIG.stores.tasks instead.
 */

export const CONFIG = {
  productName: 'CampusOS',

  db: {
    name: 'campusos-db',
    // Bump this and add an upgrade branch in core/db.js whenever the
    // schema changes. Never rename/remove a store in place — see db.js
    // migrate() for how versioned upgrades are expected to work.
    version: 2,
  },

  // Object store definitions. `keyPath: 'id'` everywhere so every record
  // gets the same stable-id shape (see utils.generateId). `indexes` are
  // the fields modules will realistically want to query/filter by.
  stores: {
    tasks: {
      name: 'tasks',
      keyPath: 'id',
      indexes: ['dueDate', 'status', 'category', 'priority'],
    },
    taskCategories: {
      name: 'taskCategories',
      keyPath: 'id',
      indexes: ['name'],
    },
    transactions: {
      name: 'transactions',
      keyPath: 'id',
      indexes: ['date', 'type', 'category'],
    },
    debts: {
      name: 'debts',
      keyPath: 'id',
      indexes: ['direction', 'settled', 'personId'],
    },
    spendeeCategories: {
      name: 'spendeeCategories',
      keyPath: 'id',
      indexes: ['name'],
    },
    people: {
      name: 'people',
      keyPath: 'id',
      indexes: ['category', 'name'],
    },
    peopleCategories: {
      name: 'peopleCategories',
      keyPath: 'id',
      indexes: ['name'],
    },
    performance: {
      name: 'performance',
      keyPath: 'id',
      indexes: ['subject', 'date', 'assessmentType'],
    },
    libraryItems: {
      name: 'libraryItems',
      keyPath: 'id',
      indexes: ['subject', 'semester', 'type'],
    },
    libraryFiles: {
      name: 'libraryFiles',
      keyPath: 'id',
      indexes: ['itemId'],
    },
    achievements: {
      name: 'achievements',
      keyPath: 'id',
      indexes: ['category', 'date'],
    },
    achievementCategories: {
      name: 'achievementCategories',
      keyPath: 'id',
      indexes: ['name'],
    },
    attendanceSubjects: {
      name: 'attendanceSubjects',
      keyPath: 'id',
      indexes: ['name'],
    },
    attendanceLog: {
      name: 'attendanceLog',
      keyPath: 'id',
      indexes: ['subjectId', 'date'],
    },
    resume: {
      name: 'resume',
      keyPath: 'id',
      indexes: [],
    },
    appConfig: {
      name: 'appConfig',
      keyPath: 'key',
      indexes: [],
    },
  },

  // What exists today vs. what's planned. The nav and dashboard both read
  // this so adding a real module later is a data change, not a rewrite.
  // status: 'active' | 'planned'
  modules: [
    { id: 'dashboard', label: 'Dashboard', icon: 'grid', href: 'index.html', status: 'active' },
    { id: 'tasks', label: 'Tasks', icon: 'check-square', href: 'pages/tasks.html', status: 'active' },
    { id: 'spendee', label: 'Spendee', icon: 'wallet', href: 'pages/spendee.html', status: 'active' },
    { id: 'people', label: 'People', icon: 'users', href: 'pages/people.html', status: 'active' },
    { id: 'performance', label: 'Performance', icon: 'trending-up', href: 'pages/performance.html', status: 'active' },
    { id: 'library', label: 'Digital Library', icon: 'book-open', href: 'pages/library.html', status: 'active' },
    { id: 'achievements', label: 'Achievements', icon: 'award', href: 'pages/achievements.html', status: 'active' },
    { id: 'attendance', label: 'Attendance', icon: 'calendar-check', href: 'pages/attendance.html', status: 'active' },
    { id: 'resume', label: 'Resume Builder', icon: 'file-text', href: 'pages/resume.html', status: 'active' },
    { id: 'settings', label: 'Settings', icon: 'settings', href: 'pages/settings.html', status: 'active' },
  ],

  defaults: {
    taskCategories: ['Assignment', 'Exam', 'Project', 'Lab', 'College', 'Personal'],
    spendeeCategories: ['Food', 'Travel', 'College', 'Shopping', 'Entertainment', 'Bills', 'Hostel', 'Other'],
    peopleCategories: ['Professors', 'Class Friends', 'Hostel Friends', 'Seniors', 'Team Members', 'Family'],
    achievementCategories: ['Olympiads', 'Workshops', 'Hackathons', 'Courses', 'Certifications', 'Competitions', 'Volunteering', 'Projects', 'Other'],
    performanceTypes: ['Class Test', 'Viva', 'Internal', 'Mid-Sem', 'End-Sem', 'Assignment', 'Practical', 'Quiz'],
  },
};
