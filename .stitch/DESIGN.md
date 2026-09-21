# Workbench 个人工作台 — DESIGN.md

A personal productivity workbench whose core is **Month Calendar + Todo List**.
It must look and feel like a modern **macOS-native** productivity app (Apple Calendar / Reminders / Things vibe): quiet, restrained, refined, content-first.

Do NOT invent new product features. Do NOT make it look like a SaaS dashboard.

## Layout (desktop)

- Left sidebar ("Today" panel): big "今天" title, secondary date line (e.g. 8月26日 · 周三), then the day's todo list. Behaves like a macOS sidebar/inspector, not a web sidebar.
- Right main area: month calendar (7-column grid) with a slim toolbar header.
- Todos also appear inside their calendar cells as lightweight task rows.
- Bottom of sidebar: low-emphasis "新建待办" action.

## Design tokens

| Token | Value |
|---|---|
| --bg-primary | #FFFFFF |
| --bg-secondary | #F7F7F8 |
| --text-primary | #1D1D1F |
| --text-secondary | #6E6E73 |
| --text-tertiary | #98989D |
| --border-subtle | #ECECEE / rgba(0,0,0,0.06) |
| --accent | #007AFF (single accent, used only for Today/Selected/Active/Focus) |
| --hover | rgba(0,0,0,0.035) |
| --selected | rgba(0,0,0,0.055) |
| --radius-sm | 6px (todo item, button) |
| --radius-md | 8px (input) |
| --radius-lg | 10–12px (popover, dialog) |

Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 / 32. Sidebar horizontal padding 16–20px, calendar header padding 20–24px, todo vertical padding 6–8px.

## Typography (system font stack: -apple-system / PingFang SC / Microsoft YaHei)

- Sidebar "今天": 24–28px semibold
- Month title (e.g. 2026年8月): 18–20px semibold
- Todo title: 14px regular/medium
- Calendar day number: 13px medium
- Secondary info: 12–13px regular, secondary/tertiary gray
- Not everything bold; weight hierarchy is restrained.

## Components

- **Todo row**: circular completion checkbox on the left, task title center; hover shows subtle background rgba(0,0,0,0.035); completed items drop opacity with line-through; radius 6–8px. No table styling.
- **Calendar toolbar**: left month title; right cluster `‹ 今天 ›` — small icon-only chevron buttons with subtle hover, near-invisible border; "今天" is a lightweight secondary button.
- **Calendar grid**: hairline dividers only (#ECECEE / rgba(0,0,0,0.06)); grid must recede into the background. Cells have no radius, no card chrome.
- **Day number**: today is highlighted only by the number itself — circular #007AFF badge with white numeral (like Apple Calendar). Other-month days at 35–40% opacity.
- **Tasks in cells**: lightweight rows — small dot or ○/● marker + 12px title, no filled event chips, hover-only faint background.
- **Popover / Dialog / Context menu**: only these may carry a very subtle shadow; radius 10–12px.
- **Animation**: 120–220ms ease-out micro-feedback only (hover, selection, checkbox, month transition). No bounce, no spring, no scale jumps.

## Avoid (hard rules)

- No gradients, no purple AI gradients, no glassmorphism-everywhere.
- No card-inside-card, no bento grids, no dashboard widgets (stats/AI/weather/quote/progress rings).
- No big welcome header; the OS window already shows the app name.
- No heavy shadows, no neon, no floating-everything.
- No large radius (16/20/24px cards). No emoji-driven UI.
- Empty calendar days stay empty — whitespace is part of the design.

## Goal

"A refined, quiet macOS-native personal productivity app that someone opens every day" — not "an Apple-flavored webpage" and not "a Dribbble concept".
