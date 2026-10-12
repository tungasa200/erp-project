---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance (Vercel rules, pinned local copy). Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
argument-hint: <file-or-pattern>
---

# Web Interface Guidelines (pinned copy)

Review files for compliance with the Web Interface Guidelines.

1. Read `guidelines.md` in this skill folder. It is a pinned copy (see SOURCE.txt). Do not fetch rules from the network.
2. Read the specified files (or ask which files/pattern to review).
3. Check them against every rule in `guidelines.md`. This project is React + Vite + CSS Modules, not Next.js or Tailwind: skip rules that only apply to those, and say which ones you skipped.
4. Output findings in the format `guidelines.md` specifies (terse `file:line`).