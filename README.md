# Daily Do

**Get things done, one day at a time.**

A friendly, personal task manager built with plain HTML, CSS and JavaScript. No
build step, no dependencies, no server — everything is saved in your browser
with `localStorage`.

## Daily Do vs. your task manager name

Daily Do keeps two names deliberately separate:

| Name | What it is | Can you change it? |
| --- | --- | --- |
| **Daily Do** | The product. Always shown on the splash screen and in the app header. | **No** |
| **Your task manager name** | Your personal name for your own list, e.g. "Grace's Tasks". Shown as the heading in the main app. | **Yes** — rename it any time from Settings |

Your name is pre-filled with the sensible default **"My Tasks"** and is saved
under its own storage key, so renaming your list never touches the branding.

## Features

### Focus for today
A short shortlist at the top of the app showing what actually needs attention
**right now** — it is deliberately capped at **5 tasks**, so it is a prioritised
view rather than a second copy of the list.

A task qualifies when it is:
- **Overdue** (weight 100)
- **Due today** (weight 80)
- **Due tomorrow** (weight 30)
- **High priority** (weight 40)
- **Has a reminder that is already due** (weight 50) or falls due within 24 hours
  (weight 20)

Tasks are ranked by score, with the list's own order breaking ties so the
shortlist does not shuffle around. Each row shows *why* it is there
(`OVERDUE`, `DUE TODAY`, `HIGH PRIORITY`, …) and lets you complete or edit the
task without leaving the section. A summary line counts the overdue and
due-today tasks and says how many more qualify beyond the cap.

### Focus mode
A distraction-free view of the same app — not a separate application. It shows
the single most relevant active task large and prominent, followed by up to
three more in a quiet queue, each with a one-tap complete button. The section
is framed in the Daily Do purple and has a clear **Exit focus mode** button
(and the same button in the Focus for today header doubles as the toggle, with
`aria-pressed` kept in sync). If everything is done, it says so plainly.

### Completion streak
- Counts **consecutive days** on which you complete at least one task
- Shown as a small `🔥 3 day streak` pill beside your statistics
- Stored under `dailyDo.streak.v1` as `{ current, longest, lastDay }`
- The same day is **never counted twice** — `lastDay` is stored as `YYYY-MM-DD`
- A **missed day resets the current streak to zero** on load, but the best
  streak is remembered
- The pill hides at zero, so it never nags you

### Undo after delete
- Deleting a task removes it immediately and shows a toast with an **Undo**
  button for 7 seconds
- Undo restores the task **exactly as it was** — title, completion state, due
  date, category, priority, reminder, recurrence, id *and* its original position
  in the list
- **Clear completed** is undoable too, restoring every removed task in order
- The toast dismisses on its own; deleting again replaces the pending undo

### Recurring tasks
Set a task to repeat **Never**, **Daily**, **Weekly** or **Monthly**, either
when creating it or from the inline editor. When you complete a repeating task,
the next occurrence is created directly after it.

| Repeat | Example | Result |
| --- | --- | --- |
| Daily | Mon 10 Mar 2026 | Tue 11 Mar 2026 |
| Weekly | Mon 10 Mar 2026 | Mon 17 Mar 2026 |
| Monthly | Thu 8 Oct 2026 | Thu 8 Nov 2026 |

- The next occurrence keeps the **title, category, priority, repeat rule and
  reminder time of day**
- **Month-end clamping:** 31 Jan repeats to 28/29 Feb rather than spilling into
  March
- **No duplicates:** a task is never allowed to spawn a second successor, so
  completing, un-completing and re-completing can never pile up copies
- A task with no due date repeats from today

### Tasks
- **Add** a task with an optional due date, category, priority and reminder
- **Due dates** — pick a date with the native date picker, or leave it empty for
  no date. The chip reads **Today**, **Tomorrow**, **Overdue**, or a formatted
  date such as `Oct 8, 2026`
- **Overdue** tasks get a soft red wash and a red edge rail, plus the word
  "Overdue" so the state never depends on colour alone
- **Categories** — Work, Personal, School or Other
- **Priorities** — Low, Medium (default) or High. Each level is shown with an
  arrow glyph (↓ → ↑) as well as its own colour, so the level never depends on
  colour alone
- **Reminders** — an optional date and time, see [Reminders](#reminders)
- **Repeat** — Never, Daily, Weekly or Monthly, see
  [Recurring tasks](#recurring-tasks)
- **Complete** a task by ticking its checkbox
- **Delete** a task with the trash icon — it can be **undone** for a few
  seconds, see [Undo after delete](#undo-after-delete)
- **Archive** a task to put it away without deleting it. Archived tasks are
  hidden from the normal list and reappear under the **Archived** filter, where
  the same button restores them
- **Edit** a task inline — title, due date, category, priority, reminder and
  repeat are all editable in one place (<kbd>Enter</kbd> saves, <kbd>Escape</kbd>
  cancels, clicking away saves). Editing keeps the task's id and completion
  state.

### Finding things
- **Search** filters the list as you type, and combines with the filters below
- **All / Active / Completed / Archived** filters
- **Category filter** in the same toolbar
- Friendly empty states explain *why* the list is empty (no tasks, no matches,
  nothing in this category, …), and when the list is genuinely clear you get a
  short encouraging line rather than a blank screen

### Re-ordering
- **Drag and drop** a task by its handle to reorder the list
- **Move up / Move down** buttons on every row — the keyboard- and
  touch-friendly alternative, so re-ordering never depends on dragging
- The new order is saved and survives a refresh
- Re-ordering is disabled while a search, filter or category is active, so
  hidden tasks can never be shuffled around by accident

### Progress
- **Statistics** — total, done, left and a completion percentage with a
  progress bar, updated immediately on every change

### Clearing up
- **Clear completed** removes all finished tasks at once, after a confirmation
  that states exactly how many will go. Active tasks are never removed.

### Appearance
- **Purple + white Daily Do branding.** Purple is the brand and every primary
  action; white is the background; dark grey is the text. Light purple is used
  only for selected states, subtle backgrounds and small badges
- The app sits in one large, centred white container with a rounded corner,
  a subtle border and a very soft shadow. Sections inside it are separated by
  spacing and hairlines rather than by stacking cards
- On phones the container becomes almost full width and drops its radius
- **Light / dark theme** toggle in the header. The first visit follows your
  system setting; once you choose, your choice is remembered. Dark mode uses a
  dark page with a slightly lighter app surface and keeps the purple branding
- Responsive from 320px phones to desktop
- Keyboard accessible throughout (visible focus rings, ARIA labels, focus-trapped
  dialogs, reduced-motion support)

### Backup
- **Export** writes a plain JSON file of your tasks, workspace name, theme and
  streak
- **Import** reads that file back. Tasks already present are matched by id, so
  importing the same backup twice will not create duplicates
- Imported data goes through the same validation as your own saved data, so a
  hand-edited file cannot break the app
- Both buttons live in the Settings dialog

## Reminders

A reminder is a date and time stored on the task. When the time arrives and the
app is open, Daily Do shows a browser notification.

**Please read this before relying on reminders.** Daily Do is a local, offline
app with no server and no background worker, so:

- A reminder can only fire **while the page is open in your browser**. If you
  close the tab or quit the browser, nothing is scheduled and nothing will be
  delivered when you come back.
- Notification permission is requested **only** when you actually pick a
  reminder time — never on page load.
- If notifications are unavailable or blocked, the reminder is still saved and
  shown on the task, and the app explains the situation in plain language
  instead of failing.
- Each reminder fires once; it is never duplicated.
- Where a notification cannot be shown, the reminder is announced in the app's
  status line instead.

## Onboarding flow

On first load, Daily Do walks you through three short steps:

1. **Splash** — the Daily Do brand and tagline, briefly, then it moves on by
   itself. No click needed.
2. **Welcome** — "Let's create your personal task manager." Enter a name (or keep
   the default) and press <kbd>Continue</kbd>.
3. **Ready** — "Your task manager is ready. What would you like to get done
   today?" Press **Add your first task** to jump into the app with the task
   field focused.

After that, Daily Do goes straight to your task manager on every visit.

## Project structure

```
to do list/
├── index.html      # Page structure (splash, welcome, app, settings dialog)
├── css/
│   └── styles.css  # Design tokens, layout, components, responsive rules
├── js/
│   └── app.js      # State, storage, rendering, screens, events, inline editing
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

| Key | Holds |
| --- | --- |
| `todoList.items.v1` | Tasks, in display order |
| `dailyDo.profile.v1` | Your task manager name |
| `dailyDo.theme.v1` | `light`, `dark`, or unset to follow the system |
| `dailyDo.streak.v1` | `{ current, longest, lastDay }` for the completion streak |

A task looks like this:

```json
{
  "id": "m1a2b3c4d5e6",
  "text": "Submit quarterly report",
  "completed": false,
  "createdAt": 1758000000000,
  "dueDate": "2026-10-08",
  "category": "work",
  "priority": "high",
  "reminder": "2026-10-08T09:00",
  "recurrence": "monthly",
  "archived": false,
  "repeatSpawned": false
}
```

- `dueDate` is a plain `YYYY-MM-DD` string, or `""` when a task has no due date.
  Dates are read as local dates, so there is no timezone drift.
- `reminder` uses the `YYYY-MM-DDTHH:mm` shape that the native datetime picker
  produces, so it round-trips without conversion.
- `category` is `""` or one of `work` / `personal` / `school` / `other`.
- `priority` is `low` / `medium` / `high` and defaults to `medium`.
- **Existing tasks keep working.** Tasks saved before these fields existed have
  no `category`, `priority` or `reminder`; they load with sensible defaults
  (no category, Medium priority, no reminder) and are never dropped or
  rewritten until you edit them. The storage key is unchanged, so no migration
  is needed.
- Data is per browser, per device — there is no server or account.
- Opening the app in two tabs keeps them in sync via the `storage` event.
- Clearing your browser's site data removes the saved tasks, name and theme.
