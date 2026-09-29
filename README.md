# Todo List

A small, clean, dependency-free todo list built with plain HTML, CSS and JavaScript.
Tasks are saved in your browser with `localStorage`, so they survive page refreshes.

## Features

- **Add** a task from the input box (press <kbd>Enter</kbd> or the **Add task** button)
- **Complete** a task by ticking its checkbox (or clicking the task text)
- **Delete** a task with the trash icon
- **Edit** a task inline — click the pencil icon or double-click the text
  (<kbd>Enter</kbd> saves, <kbd>Escape</kbd> cancels)
- **Filter** by All / Active / Completed
- **Clear completed** removes every finished task at once
- Live counter in the footer
- Responsive layout for desktop, tablet and mobile
- Automatic light/dark theme based on your system setting
- Keyboard accessible (visible focus rings, ARIA labels, reduced-motion support)

## Project structure

```
to do list/
├── index.html      # Page structure
├── css/
│   └── styles.css  # Design tokens, layout, components, responsive rules
├── js/
│   └── app.js      # State, rendering, events, localStorage
└── README.md
```

## How to run locally

There is **no build step and no dependencies**. Pick any option:

### Option 1 — Open the file directly (quickest)

Double-click `index.html`, or right-click it and choose **Open with → Google Chrome /
Edge / Firefox**.

### Option 2 — Run a local web server (recommended)

This gives you a real `http://` origin, so `localStorage` behaves consistently.

With **Node.js** installed, from this folder run:

```bash
npx serve .          # or: npx http-server -p 8080
```

With **Python** installed:

```bash
python -m http.server 8000
```

Then visit <http://localhost:8000> (or the port printed by `serve`).

## Notes on storage

- Data is saved under the key `todoList.items.v1` in `localStorage`.
- Tasks are stored per browser, per device — there is no server or account.
- Opening the app in two tabs keeps them in sync via the `storage` event.
- Clearing your browser's site data removes the saved tasks.
