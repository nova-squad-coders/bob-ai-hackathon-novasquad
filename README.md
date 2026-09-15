# 🚀 CampusOS Copilot

> **CampusOS Copilot** is a context-aware AI student assistant integrated into CampusOS. It uses relevant student data to provide personalized insights and recommendations.

---

## 👥 Team

| Field | Value |
|---|---|
| **Team Name** | NovaSquad |
| **Track** | AI |
| **Team Lead** | Madhav Gandhi |
| **Members** | Madhav Gandhi and Team NovaSquad |

---

## 🎯 Problem Statement

Students manage academic performance, attendance, tasks, and personal finances across separate workflows. This makes it difficult to understand their overall situation and make personalized day-to-day decisions.

---

## 💡 Solution

CampusOS Copilot is a context-aware AI assistant integrated into CampusOS. It reads relevant student data from the application's local data layer and uses Gemini to provide personalized insights and recommendations.

The AI does not directly access the database. CampusOS provides only the relevant context required for each request.

---

## ✨ Key Features

- 🤖 Context-aware AI recommendations based on actual student data
- 📊 Attendance insights and class decision support
- ✅ Task prioritization and daily focus recommendations
- 💰 Financial guidance based on spending data
- 📚 Academic performance analysis
- 💬 Persistent Copilot conversation history
- 🖥️ Resizable right-side AI drawer
- 📱 Responsive mobile interface
- 🌙 Light and dark mode support

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | HTML, CSS, JavaScript |
| **Frameworks** | None — Vanilla JavaScript |
| **AI** | Google Gemini API |
| **Database** | IndexedDB |
| **IBM Technologies** | IBM Bob |
| **Other** | GitHub, GitHub Actions, Local Storage |

---

## 📁 Repository Structure

```text
├── src/
│   └── CampusOS/
│       ├── css/
│       ├── js/
│       ├── pages/
│       ├── assets/
│       └── index.html
├── docs/
│   ├── problem-statement.md
│   ├── solution-overview.md
│   ├── architecture.md
│   └── setup-guide.md
├── demo/
│   ├── screenshots/
│   ├── demo-video-link.txt
│   └── live-demo-url.txt
├── bob_sessions/
├── presentation/
└── submission.yaml
