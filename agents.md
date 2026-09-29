# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this project is

A small, clean, **dependency-free** todo list built with plain HTML, CSS and JavaScript.

There is **no build step, no bundler, no package manager, no `package.json` and no test
suite**. The whole app is three files that the browser loads directly.

Core design principles:

- **100% client-side.** There is no backend, no API and no account system. Nothing is
  ever sent over the network.
- **Persistence is `localStorage` only**, under the key `todoList.items.v1`. Data is
  per browser and per device.
- **In-memory state is the source of truth during a session.** `state.items` is mutated
  by the data operations, then mirrored to `localStorage` after every change.
- **Full re-render on change.** There is no virtual DOM and no diffing. `render()` wipes
  and rebuilds the list from state.
- **Accessible by default** — keyboard operable, ARIA-labelled, visible focus rings and
  `prefers-reduced-motion` support are requirements, not nice-to-haves.
- **Responsive and theme-aware** — layout adapts from mobile to desktop and follows the
  system light/dark preference.

## Project structure

```
to do list/
├── index.html      # Page structure and the <template> for task rows
├── css/
│   └── styles.css  # Design tokens, base, layout, components, a11y, responsive
├── js/
│   └── app.js      # State, storage, rendering, events, inline editing
├── README.md       # User-facing documentation
└── agents.md       # This file
```

### `index.html`

- Static markup only. It contains the app shell, the add-task form, the filter toolbar,
  the empty state, the footer status line, and a `<template id="todo-item-template">`
  that is cloned once per task row by JavaScript.
- Scripts and stylesheets are referenced with plain relative paths
  (`css/styles.css`, `js/app.js`). No bundler, no import maps, no CDN.
- The template is the contract between HTML and JS. **If you rename a class inside the
  template, you must update the matching selectors in `js/app.js` and `css/styles.css`.`

### `css/styles.css`

Organised into numbered, banner-commented sections that must be kept in order:

1. Design tokens (`:root` custom properties)
2. Base / reset
3. Layout
4. Form + buttons
5. Toolbar + filters
6. Task list
7. Empty state + footer
8. Accessibility
9. Responsive tweaks

### `js/app.js`

A single IIFE with `"use strict"`, internally sectioned with banner comments in this
order: **Storage → Data operations → Rendering → Inline editing → Events → Init.**

## How to run the app locally

There is nothing to install or compile. Pick one:

**Quickest — open the file directly**

Open `index.html` in Chrome, Edge or Firefox.

**Recommended — local web server** (gives a real `http://` origin so `localStorage`
behaves consistently)

```bash
npx serve .              # or: npx http-server -p 8080
python -m http.server 8000
```

Then open <http://localhost:8000>.

To check your work, also test at a narrow width (~375px) for the mobile layout and
toggle your OS theme to verify dark mode.

## Coding guidelines

### JavaScript

- **Match the existing ES5 style.** The file uses `var`, `function` expressions and
  callbacks. Do **not** introduce `let`/`const`, arrow functions, template literals,
  classes, `async/await` or spread. Consistency with the surrounding code matters more
  than modernising it.
- Keep everything inside the existing IIFE. Do not add global variables or a second
  top-level script.
- Naming: `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants
  (`STORAGE_KEY`, `MAX_LENGTH`), lowercase object keys (`EMPTY_STATES.noTasks`).
- Prefer delegated listeners on `#todo-list` over per-row listeners — the list is
  re-rendered constantly, so row-level listeners would be lost and would leak.
- Every state mutation must be followed by `saveItems()` **and** `render()`.
- Never inject user text via `innerHTML`. Use `textContent` (as `buildItemElement`
  does) to avoid XSS.
- User input is normalised and truncated through the same path in `addItem` and
  `updateItem`: collapse whitespace, trim, slice to `MAX_LENGTH`.
- Wrap `localStorage` access in `try/catch` (private browsing and disabled storage
  throw) and surface failures with `flashStatus(...)` rather than crashing.
- Comment *why*, not *what*. Existing comments are sparse and explain intent.

### CSS

- **All colours, radii, shadows and durations come from the custom properties in
  `:root`.** Never hard-code a hex value or a timing outside the token blocks.
- Dark mode is a token override inside `@media (prefers-color-scheme: dark)`. If you
  add a new token, add both the light and the dark value.
- Class naming is BEM-ish: `block__element` and `block--modifier`
  (`todo-item__title`, `btn--primary`, `icon-btn--danger`, `todo-item.is-done`).
- State classes are `is-*` (`is-active`, `is-done`, `is-error`).
- Transitions must use `var(--transition)`.
- Put new rules in the correct numbered section and keep the section banners intact.

### HTML

- Semantic elements only (`main`, `header`, `form`, `ul`/`li`, `label`, `button`).
- Icon-only buttons need both a `title` and an `aria-label`. Icon SVGs are inline with
  `aria-hidden="true" focusable="false"`.
- Every new interactive control needs a real associated `<label>` (use
  `.visually-hidden` when the label should not be visible) and a keyboard path.

### Accessibility (treat as a requirement)

- Everything must be reachable and operable with the keyboard alone. Test with `Tab`.
- Inline editing: <kbd>Enter</kbd> saves, <kbd>Escape</kbd> cancels, and `blur` saves —
  preserve all three behaviours, and guard against double-commit.
- Dynamic status text lives in `#save-status`, which already has
  `role="status" aria-live="polite"`.
- Filter buttons must keep `aria-pressed` in sync with `is-active` in `renderFilters()`.
- Never remove the `:focus-visible` outline or the
  `@media (prefers-reduced-motion: reduce)` block.

### Documentation

- `README.md` is user-facing: keep the feature list, the structure tree and the run
  instructions accurate when you change behaviour. If you add a feature, document it
  there too.

## How an AI coding agent should make changes safely

**Scope**

- Change only the files the task requires. Do not reformat, reorder or "tidy" files you
  were not asked to touch, and never add `package.json`, dependencies, a bundler or a
  build config — the dependency-free property is the core of the project.
- Keep diffs minimal and targeted. Read a file in full before editing it.

**Understand the coupling**

The three files are tightly coupled by class names and element IDs. Before you rename
anything, search the whole repo:

- A class in `index.html` is matched in `css/styles.css` **and** queried in `js/app.js`.
- An `id` in `index.html` is cached in `els` inside `init()` and used in the render
  functions.
- Changing the shape of a task object (`{ id, text, completed, createdAt }`) affects
  `loadItems()`, which sanitises and migrates persisted data. Handle unknown or legacy
  data defensively there.
- If you change the persisted shape, be aware existing users' `localStorage` data
  already exists. Bump `STORAGE_KEY` to a new version (e.g. `todoList.items.v2`) to
  avoid a migration problem, and note it in the README.

**Verify before you finish**

1. Open the app (local server preferred) and confirm there are **no errors in the
   browser console** — a `null` from a `querySelector` is the most common regression.
2. Exercise every affected path manually: add, toggle, edit, delete, filter, clear
   completed, and reload the page to confirm persistence.
3. Test with an empty list (all three empty states), a long 200-character task, and
   tasks containing quotes, `<`, `&` and emoji.
4. Test the narrow mobile layout and the dark theme.
5. Keyboard-only pass: `Tab` through the page, edit with <kbd>Enter</kbd>/<kbd>Escape</kbd>,
   and confirm focus is always visible.
6. Cross-tab: open the app in two tabs and confirm the `storage` event keeps them in
   sync.

**Behaviour and safety rules**

- Never silently drop or reorder user tasks. `clearCompleted()` and `removeItem()` are
  the only destructive operations — do not add new ones without being asked.
- Keep the 200-character `MAX_LENGTH` limit enforced in both the UI and the data layer.
- Do not add network requests, analytics, CDNs, fonts or tracking of any kind.
- Do not add `innerHTML` with user data, `eval`, or `localStorage` writes outside the
  `saveItems()` / `loadItems()` helpers.
- If a change requires something you were not authorised to do (new dependency, new
  file, storage migration, changing the storage key), stop and ask first.
- State clearly in your final summary what you changed, how you verified it, and any
  assumption or limitation you made.
