/**
 * Daily Do — application logic
 *
 * Plain JavaScript, no dependencies, no build step.
 * State lives in memory and is mirrored to localStorage after every change.
 */
(function () {
  "use strict";

  /* "Daily Do" is the product name and is never stored or edited. The user's
     own name for their task manager lives separately under PROFILE_KEY. */
  var BRAND_NAME = "Daily Do";
  var ITEMS_KEY = "todoList.items.v1";
  var PROFILE_KEY = "dailyDo.profile.v1";
  var THEME_KEY = "dailyDo.theme.v1";
  var STREAK_KEY = "dailyDo.streak.v1";
  var DEFAULT_WORKSPACE_NAME = "My Tasks";
  var MAX_LENGTH = 200;
  var MAX_NAME_LENGTH = 60;
  var SPLASH_MS = 1700;
  var REDUCED_SPLASH_MS = 600;
  var SCREEN_MS = 300;
  var REMINDER_TICK_MS = 30000;
  var UNDO_MS = 7000;
  /* Focus for Today is deliberately capped: a shortlist, not a second list. */
  var FOCUS_MAX = 5;

  var CATEGORIES = {
    work: "Work",
    personal: "Personal",
    school: "School",
    other: "Other"
  };

  var PRIORITIES = {
    low: "Low",
    medium: "Medium",
    high: "High"
  };
  var DEFAULT_PRIORITY = "medium";

  var RECURRENCES = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly"
  };

  /* Encouraging lines shown when the list is clear. Chosen from a stable
     index so the message does not flicker on every render. */
  var CHEERS = [
    "Clean list. Enjoy the quiet.",
    "Everything is done. Well done.",
    "Nothing left today — you earned it.",
    "All clear. Time for a proper break.",
    "You cleared the deck. Nice work."
  ];

  var FOCUS_EMPTY = [
    "You are all caught up. Pick something small to get started.",
    "No urgent work right now. Add a task or take a breather."
  ];

  var EMPTY_STATES = {
    noTasks: {
      icon: "📝",
      title: "No tasks yet",
      text: "Add your first task using the field above."
    },
    noActive: {
      icon: "☕",
      title: "Nothing left to do",
      text: "No active tasks right now — enjoy the break."
    },
    noCompleted: {
      icon: "🕒",
      title: "Nothing completed yet",
      text: "Finished tasks will show up here."
    },
    noSearchResults: {
      icon: "🔍",
      title: "No matches",
      text: "No task matches your search. Try a different word."
    },
    noSearchResultsFiltered: {
      icon: "🔍",
      title: "No matches here",
      text: "No task matches this search in the current filter."
    },
    noCategoryResults: {
      icon: "🗂",
      title: "Nothing in this category",
      text: "No tasks are filed under this category yet."
    }
  };

  var els = {};
  var state = {
    items: [],
    filter: "all",
    workspaceName: "",
    search: "",
    category: "",
    theme: "system",
    streak: { current: 0, longest: 0, lastDay: "" },
    focusMode: false
  };
  var statusTimer = null;
  var screenTimer = null;
  var leaveTimer = null;
  var leaveNode = null;
  var currentScreen = null;
  var lastFocused = null;
  var draggedId = null;
  var remindTimer = null;
  var firedReminders = {};
  var confirmResolve = null;

  /* --- Storage -------------------------------------------------------- */

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadItems() {
    try {
      var raw = window.localStorage.getItem(ITEMS_KEY);
      if (!raw) return [];
      return sanitiseItems(JSON.parse(raw));
    } catch (error) {
      console.warn("Could not read saved tasks:", error);
      return [];
    }
  }

  /* Shared by loading and by import, so an untrusted backup file goes through
     exactly the same validation as stored data. */
  function sanitiseItems(parsed) {
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(function (item) {
        return item && typeof item.text === "string" && item.text.trim() !== "";
      })
      .map(function (item) {
          return {
            id: typeof item.id === "string" ? item.id : createId(),
            text: item.text.slice(0, MAX_LENGTH),
            completed: Boolean(item.completed),
            createdAt: Number(item.createdAt) || Date.now(),
            // Tasks saved before due dates existed have no dueDate field.
            dueDate: normaliseDate(item.dueDate),
            // Added later still; absent values fall back to safe defaults so
            // old tasks load untouched instead of being dropped.
            category: normaliseCategory(item.category),
            priority: normalisePriority(item.priority),
            reminder: normaliseReminder(item.reminder),
            // Phase 1 fields. Anything missing on an older task becomes a
            // harmless default, so no migration is ever required.
            recurrence: normaliseRecurrence(item.recurrence),
            archived: Boolean(item.archived),
            // Guards against a second occurrence being spawned for the same
            // completion, which is what would create duplicate repeats.
            repeatSpawned: Boolean(item.repeatSpawned)
          };
        });
  }

  function saveItems() {
    try {
      window.localStorage.setItem(ITEMS_KEY, JSON.stringify(state.items));
      flashStatus("Saved locally", true);
      return true;
    } catch (error) {
      console.warn("Could not save tasks:", error);
      flashStatus("Could not save in this browser", false);
      return false;
    }
  }

  /* Returns "" when there is no saved name, which is what drives the
     onboarding flow on first run. */
  function loadWorkspaceName() {
    try {
      var raw = window.localStorage.getItem(PROFILE_KEY);
      if (!raw) return "";
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.name !== "string") return "";
      return normaliseName(parsed.name);
    } catch (error) {
      console.warn("Could not read saved task manager name:", error);
      return "";
    }
  }

  function saveWorkspaceName(name) {
    try {
      window.localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: name }));
      return true;
    } catch (error) {
      console.warn("Could not save task manager name:", error);
      return false;
    }
  }

  function normaliseName(raw) {
    return String(raw == null ? "" : raw)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME_LENGTH);
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  /* --- Screens --------------------------------------------------------- */

  /* Exactly one of splash / welcome / app is visible at a time. The outgoing
     screen is made inert immediately (so it can never hold focus) and is only
     unhidden after its fade-out has finished. */
  function showScreen(node) {
    if (!node || currentScreen === node) return;

    // A screen that is still fading out must not be left behind in the DOM.
    if (leaveNode) {
      window.clearTimeout(leaveTimer);
      leaveNode.hidden = true;
      leaveNode.classList.remove("is-leaving");
      leaveNode = null;
    }

    if (currentScreen) {
      var previous = currentScreen;
      leaveNode = previous;
      previous.setAttribute("inert", "");
      previous.setAttribute("aria-hidden", "true");
      previous.classList.add("is-leaving");
      leaveTimer = window.setTimeout(function () {
        previous.hidden = true;
        previous.classList.remove("is-leaving");
        if (leaveNode === previous) leaveNode = null;
      }, SCREEN_MS);
    }

    currentScreen = node;
    node.hidden = false;
    node.removeAttribute("inert");
    node.removeAttribute("aria-hidden");
    node.classList.remove("is-leaving");
  }

  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function focusWhenReady(element) {
    if (!element) return;
    window.setTimeout(function () {
      if (element.isConnected) element.focus();
    }, 40);
  }

  /* --- Dates ----------------------------------------------------------- */

  /* Due dates are stored as plain "YYYY-MM-DD" strings, which sort and compare
     correctly as text and never drift with the browser's time zone. */
  function normaliseDate(raw) {
    if (typeof raw !== "string") return "";
    var value = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
    // Guards against impossible values such as 2026-02-31.
    var parts = value.split("-");
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (
      date.getFullYear() !== Number(parts[0]) ||
      date.getMonth() !== Number(parts[1]) - 1 ||
      date.getDate() !== Number(parts[2])
    ) {
      return "";
    }
    return value;
  }

  function todayIso() {
    return toIsoDate(new Date());
  }

  function toIsoDate(date) {
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return date.getFullYear() + "-" + month + "-" + day;
  }

  function parseIsoDate(value) {
    var parts = value.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function formatDate(timestamp) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(timestamp));
    } catch (error) {
      return new Date(timestamp).toLocaleString();
    }
  }

  function formatDueDate(value) {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        parseIsoDate(value)
      );
    } catch (error) {
      return parseIsoDate(value).toDateString();
    }
  }

  function renderFocusToday() {
    if (!els.focusToday) return;
    var ranked = focusCandidates();
    var shown = ranked.slice(0, FOCUS_MAX);

    els.focusToday.hidden = shown.length === 0;
    if (!shown.length) return;

    var overdue = ranked.filter(function (entry) {
      return entry.meta.reasons.indexOf("overdue") > -1;
    }).length;
    var dueToday = ranked.filter(function (entry) {
      return entry.meta.reasons.indexOf("due today") > -1;
    }).length;

    var bits = [];
    if (overdue) bits.push(overdue + " overdue");
    if (dueToday) bits.push(dueToday + " due today");
    var summary = bits.length ? bits.join(" · ") : "High-priority work";
    // Never list more than the cap, but say plainly that more exist.
    if (ranked.length > shown.length) {
      summary += " · +" + (ranked.length - shown.length) + " more";
    }
    els.focusTodaySummary.textContent = summary;

    els.focusTodayList.textContent = "";
    shown.forEach(function (entry) {
      els.focusTodayList.appendChild(buildFocusRow(entry));
    });
  }

  function buildFocusRow(entry) {
    var item = entry.item;
    var row = document.createElement("li");
    row.className = "focus-row";
    row.dataset.id = item.id;

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "focus-row__check";
    checkbox.setAttribute("aria-label", "Complete \"" + item.text + "\"");
    checkbox.addEventListener("change", function () {
      toggleItem(item.id);
      render();
    });

    var text = document.createElement("span");
    text.className = "focus-row__text";

    var title = document.createElement("span");
    title.className = "focus-row__title";
    title.textContent = item.text;
    text.appendChild(title);

    // The single most useful "why is it here" reason, as a text chip.
    var reason = entry.meta.reasons[0] || "important";
    var chip = document.createElement("span");
    chip.className = "focus-row__reason is-" + reason.replace(/\s+/g, "-");
    chip.textContent = reason;
    text.appendChild(chip);

    var actions = document.createElement("span");
    actions.className = "focus-row__actions";

    var edit = document.createElement("button");
    edit.type = "button";
    edit.className = "icon-btn icon-btn--ghost";
    edit.setAttribute("aria-label", "Edit \"" + item.text + "\"");
    edit.textContent = "Edit";
    edit.addEventListener("click", function () {
      var row = els.list.querySelector('[data-id="' + item.id + '"]');
      if (row) startEditing(row, "text");
    });
    actions.appendChild(edit);

    row.appendChild(checkbox);
    row.appendChild(text);
    row.appendChild(actions);
    return row;
  }

  /* --- Focus mode -------------------------------------------------------- */

  function enterFocusMode() {
    state.focusMode = true;
    render();
    focusWhenReady(els.focusModeExit);
  }

  function exitFocusMode() {
    state.focusMode = false;
    render();
  }

  function renderFocusMode() {
    if (!els.focusMode) return;
    els.focusMode.hidden = !state.focusMode;
    els.focusModeBtn.setAttribute("aria-pressed", String(state.focusMode));

    if (!state.focusMode) return;

    // Focus mode shows the single most relevant task, then a short queue.
    var ranked = focusCandidates();
    var active = state.items.filter(function (item) {
      return !item.completed && !item.archived;
    });

    els.focusModeBody.textContent = "";

    if (!active.length) {
      var done = document.createElement("p");
      done.className = "focus-mode__empty";
      done.textContent = "Every task is done. Enjoy the calm.";
      els.focusModeBody.appendChild(done);
      return;
    }

    if (!ranked.length) {
      var calm = document.createElement("p");
      calm.className = "focus-mode__empty";
      calm.textContent = FOCUS_EMPTY[state.items.length % FOCUS_EMPTY.length];
      els.focusModeBody.appendChild(calm);
    }

    var primary = ranked.length ? ranked[0].item : active[0];
    els.focusModeBody.appendChild(buildFocusCard(primary, true));

    active
      .filter(function (item) {
        return item !== primary;
      })
      .slice(0, 3)
      .forEach(function (item) {
        els.focusModeBody.appendChild(buildFocusCard(item, false));
      });
  }

  function buildFocusCard(item, isPrimary) {
    var card = document.createElement("article");
    card.className = "focus-card" + (isPrimary ? " focus-card--primary" : "");
    card.dataset.id = item.id;

    var check = document.createElement("button");
    check.type = "button";
    check.className = "focus-card__check";
    check.setAttribute("aria-label", "Mark \"" + item.text + "\" as complete");
    check.textContent = "○";
    check.addEventListener("click", function () {
      toggleItem(item.id);
      render();
    });

    var body = document.createElement("div");
    body.className = "focus-card__body";

    var title = document.createElement("p");
    title.className = "focus-card__title";
    title.textContent = item.text;
    body.appendChild(title);

    var bits = [];
    if (item.dueDate) {
      var due = dueMeta(item);
      bits.push(due ? due.label : formatDueDate(item.dueDate));
    }
    if (item.category && CATEGORIES[item.category]) bits.push(CATEGORIES[item.category]);
    if (item.recurrence && RECURRENCES[item.recurrence]) {
      bits.push(RECURRENCES[item.recurrence] + " repeat");
    }
    if (bits.length) {
      var meta = document.createElement("p");
      meta.className = "focus-card__meta";
      meta.textContent = bits.join(" · ");
      body.appendChild(meta);
    }

    card.appendChild(check);
    card.appendChild(body);
    return card;
  }
  /* Classifies a task's due date for styling and returns the chip label.
     `today`/`tomorrow`/`overdue` are also used as CSS state classes. */
  function dueMeta(item) {
    if (!item.dueDate) return null;

    var today = todayIso();
    var tomorrow = toIsoDate(new Date(Date.now() + 86400000));
    var yesterday = toIsoDate(new Date(Date.now() - 86400000));
    var stateName = "";
    var label;

    if (item.dueDate === today) {
      stateName = "is-today";
      label = "Today";
    } else if (item.dueDate === tomorrow) {
      stateName = "is-tomorrow";
      label = "Tomorrow";
    } else if (item.dueDate < today && !item.completed) {
      stateName = "is-overdue";
      label = "Overdue";
    }

    // Completed tasks are never "overdue" — they were finished in time.
    if (item.completed && stateName === "is-overdue") stateName = "";

    return {
      stateName: stateName,
      label: label || formatDueDate(item.dueDate),
      // The visible chip is deliberately short; this is the full sentence
      // that screen readers announce.
      accessible: dueSentence(item.dueDate, label, yesterday)
    };
  }

  function dueSentence(value, label, yesterday) {
    var date = formatDueDate(value);
    if (label === "Overdue") return "Overdue — due " + date;
    if (label === "Today") return "Due today, " + date;
    if (label === "Tomorrow") return "Due tomorrow, " + date;
    if (value === yesterday) return "Due yesterday, " + date;
    return "Due " + date;
  }

  function normaliseCategory(raw) {
    if (typeof raw !== "string") return "";
    var value = raw.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(CATEGORIES, value) ? value : "";
  }

  function normalisePriority(raw) {
    if (typeof raw !== "string") return DEFAULT_PRIORITY;
    var value = raw.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITIES, value) ? value : DEFAULT_PRIORITY;
  }

  /* "" means the task does not repeat. */
  function normaliseRecurrence(raw) {
    if (typeof raw !== "string") return "";
    var value = raw.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(RECURRENCES, value) ? value : "";
  }

  /* Works out the next due date for a repeating task.
     - daily:   +1 day
     - weekly:  +7 days
     - monthly: same day number next month, clamped to the last valid day so
                31 January becomes 28/29 February rather than an invalid date. */
  function nextDueDate(recurrence, fromIso) {
    var base = fromIso && normaliseDate(fromIso) ? parseIsoDate(fromIso) : new Date();
    var year = base.getFullYear();
    var month = base.getMonth();
    var day = base.getDate();

    if (recurrence === "daily") {
      var nextDay = new Date(year, month, day + 1);
      return toIsoDate(nextDay);
    }
    if (recurrence === "weekly") {
      return toIsoDate(new Date(year, month, day + 7));
    }
    if (recurrence === "monthly") {
      var targetMonth = month + 1;
      var targetYear = year;
      if (targetMonth > 11) {
        targetMonth = 0;
        targetYear = year + 1;
      }
      // Day 0 of the following month is the last day of this one, which is
      // how the clamp is done without a hard-coded table of month lengths.
      var lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
      return toIsoDate(new Date(targetYear, targetMonth, Math.min(day, lastDay)));
    }
    return "";
  }

  /* A reminder has to move with the task, keeping the same time of day. */
  function shiftReminder(reminder, fromIso, nextIso) {
    if (!reminder || !nextIso) return "";
    var time = reminder.slice(11, 16);
    var from = fromIso || reminder.slice(0, 10);
    if (from === nextIso) return reminder;
    return nextIso + "T" + time;
  }

  /* Reminders use the "YYYY-MM-DDTHH:mm" shape that <input type="datetime-local">
     speaks, so the value round-trips without any timezone conversion. */
  function normaliseReminder(raw) {
    if (typeof raw !== "string") return "";
    var value = raw.trim();
    if (!value) return "";
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
    var datePart = normaliseDate(value.slice(0, 10));
    if (!datePart) return "";
    var hours = Number(value.slice(11, 13));
    var minutes = Number(value.slice(14, 16));
    if (hours > 23 || minutes > 59) return "";
    return datePart + "T" + value.slice(11, 16);
  }

  function reminderToDate(value) {
    if (!value) return null;
    var parts = value.split("T");
    var date = parseIsoDate(parts[0]);
    date.setHours(Number(parts[1].slice(0, 2)), Number(parts[1].slice(3, 5)), 0, 0);
    return date;
  }

  function formatReminder(value) {
    var date = reminderToDate(value);
    if (!date) return "";
    var time;
    try {
      time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    } catch (error) {
      time = date.toLocaleTimeString();
    }
    var dayLabel = "";
    if (value.slice(0, 10) === todayIso()) {
      dayLabel = "Today ";
    } else if (value.slice(0, 10) === toIsoDate(new Date(Date.now() + 86400000))) {
      dayLabel = "Tomorrow ";
    }
    return dayLabel + time;
  }

  /* --- Streak ---------------------------------------------------------- */

  /* The streak counts consecutive days with at least one completed task.
     `lastDay` is stored as YYYY-MM-DD, which is what stops the same day being
     counted twice, and lets a missed day be detected on load. */
  function loadStreak() {
    var empty = { current: 0, longest: 0, lastDay: "" };
    try {
      var raw = window.localStorage.getItem(STREAK_KEY);
      if (!raw) return empty;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return empty;
      return {
        current: Math.max(0, Number(parsed.current) || 0),
        longest: Math.max(0, Number(parsed.longest) || 0),
        lastDay: normaliseDate(parsed.lastDay)
      };
    } catch (error) {
      console.warn("Could not read streak:", error);
      return empty;
    }
  }

  function saveStreak() {
    try {
      window.localStorage.setItem(STREAK_KEY, JSON.stringify(state.streak));
    } catch (error) {
      console.warn("Could not save streak:", error);
    }
  }

  /* Drops the streak to zero once a whole day has been missed, so a streak
     never "resumes" days later. */
  function refreshStreak() {
    var today = todayIso();
    var last = state.streak.lastDay;

    if (!last) return;
    if (last === today) return;

    var yesterday = toIsoDate(new Date(Date.now() - 86400000));
    if (last !== yesterday) {
      state.streak.current = 0;
      state.streak.lastDay = today;
      saveStreak();
    }
  }

  /* Called whenever a task is completed. */
  function recordCompletion() {
    var today = todayIso();
    var last = state.streak.lastDay;

    if (last === today) {
      // Already counted today: never count the same day twice.
      return false;
    }

    var yesterday = toIsoDate(new Date(Date.now() - 86400000));
    state.streak.current = last === yesterday ? state.streak.current + 1 : 1;
    state.streak.lastDay = today;
    if (state.streak.current > state.streak.longest) {
      state.streak.longest = state.streak.current;
    }
    saveStreak();
    return true;
  }

  function streakLabel() {
    var n = state.streak.current;
    if (n <= 0) return "";
    return n + " day streak" + (n === 1 ? "" : "s");
  }

  function renderStreak() {
    if (!els.streak) return;
    var label = streakLabel();
    els.streak.hidden = label === "";
    if (label) {
      els.streakText.textContent = label;
      els.streak.setAttribute(
        "aria-label",
        "Completion streak: " + label + ". Best: " + state.streak.longest + "."
      );
    }
  }

  /* --- Theme ----------------------------------------------------------- */

  /* "system" is the stored default on first run so the app matches the OS.
     Any explicit choice is written back and wins from then on. */
  function loadTheme() {
    try {
      var raw = window.localStorage.getItem(THEME_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    } catch (error) {
      console.warn("Could not read saved theme:", error);
    }
    return "system";
  }

  function saveTheme(theme) {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      console.warn("Could not save theme:", error);
    }
  }

  function applyTheme(theme) {
    state.theme = theme;
    var root = document.documentElement;

    // Remove first so "system" genuinely falls back to the media query.
    root.removeAttribute("data-theme");
    if (theme === "light" || theme === "dark") {
      root.setAttribute("data-theme", theme);
    }

    if (els.themeBtn) {
      var resolved = theme === "system" ? systemPrefersDark() ? "dark" : "light" : theme;
      var next = resolved === "dark" ? "light" : "dark";
      els.themeBtn.setAttribute("aria-label", "Switch to " + next + " theme");
      els.themeBtn.setAttribute("title", "Switch to " + next + " theme");
      els.themeBtn.setAttribute("aria-pressed", String(resolved === "dark"));
    }
  }

  function systemPrefersDark() {
    return Boolean(
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function toggleTheme() {
    var resolved = state.theme === "system" ? (systemPrefersDark() ? "dark" : "light") : state.theme;
    var next = resolved === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
    flashStatus(next === "dark" ? "Dark theme on" : "Light theme on", true);
  }

  /* --- Reminders -------------------------------------------------------- */

  function notificationsSupported() {
    return typeof window.Notification === "function";
  }

  function notificationState() {
    if (!notificationsSupported()) return "unsupported";
    return window.Notification.permission;
  }

  /* Permission is only ever requested from a deliberate user action, never on
     page load. */
  function requestNotificationPermission(onDone) {
    if (!notificationsSupported()) {
      onDone("unsupported");
      return;
    }
    if (window.Notification.permission === "granted") {
      onDone("granted");
      return;
    }
    if (window.Notification.permission === "denied") {
      onDone("denied");
      return;
    }
    try {
      var result = window.Notification.requestPermission(function (permission) {
        onDone(permission);
      });
      // Some browsers return a promise instead of using the callback.
      if (result && typeof result.then === "function") {
        result.then(onDone, function () {
          onDone(window.Notification.permission);
        });
      }
    } catch (error) {
      onDone("denied");
    }
  }

  function reminderSupportMessage() {
    var permission = notificationState();
    if (permission === "unsupported") {
      return "This browser cannot show notifications, so reminders will be kept on your task but not announced.";
    }
    if (permission === "denied") {
      return "Notifications are blocked for this site, so reminders stay on your task without an alert.";
    }
    if (permission === "default") {
      return "Reminders only appear while this page is open in the background — a closed browser cannot alert you.";
    }
    return "Reminders fire only while this page is open in the background. A closed browser cannot alert you.";
  }

  function renderReminderNote() {
    if (!els.reminderNote) return;
    els.reminderNote.textContent = els.reminder.value ? reminderSupportMessage() : "";
  }

  /* Polls locally rather than using a service worker: there is no backend, so
     a closed tab genuinely cannot deliver anything. */
  function startReminderLoop() {
    stopReminderLoop();
    checkReminders();
    remindTimer = window.setInterval(checkReminders, REMINDER_TICK_MS);
  }

  function stopReminderLoop() {
    if (remindTimer) {
      window.clearInterval(remindTimer);
      remindTimer = null;
    }
  }

  function checkReminders() {
    if (!state.items.length) return;
    var now = Date.now();
    var due = [];

    state.items.forEach(function (item) {
      if (!item.reminder || item.completed) return;
      if (firedReminders[item.id + "|" + item.reminder]) return;
      var when = reminderToDate(item.reminder);
      if (!when || when.getTime() > now) return;

      // Mark as fired even when notifications are unavailable, so the same
      // reminder cannot fire again on every tick.
      firedReminders[item.id + "|" + item.reminder] = true;
      due.push(item);
    });

    if (!due.length) return;

    // Save first: saveItems() writes "Saved locally" to the status line, and
    // announcing afterwards keeps the reminder message visible.
    saveItems();
    due.forEach(fireReminder);
    render();
  }

  function fireReminder(item) {
    var permission = notificationState();
    var body = item.dueDate
      ? "Due " + formatDueDate(item.dueDate) + "."
      : "Tap to open Daily Do and finish it off.";

    if (permission === "granted") {
      try {
        var notification = new window.Notification("Daily Do — " + item.text, {
          body: body,
          tag: "dailydo-" + item.id
        });
        notification.onclick = function () {
          window.focus();
          try {
            notification.close();
          } catch (error) {
            /* already closed */
          }
        };
        return;
      } catch (error) {
        console.warn("Could not show notification:", error);
      }
    }

    // Fall back to the in-page live region, which always works.
    flashStatus("Reminder: " + item.text, false);
  }


  /* --- Data operations ------------------------------------------------ */

  function addItem(rawText, rawDueDate, extras) {
    var text = String(rawText).replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
    if (!text) return false;
    var details = extras || {};

    state.items.push({
      id: createId(),
      text: text,
      completed: false,
      createdAt: Date.now(),
      dueDate: normaliseDate(rawDueDate),
      category: normaliseCategory(details.category),
      priority: normalisePriority(details.priority),
      reminder: normaliseReminder(details.reminder),
      recurrence: normaliseRecurrence(details.recurrence),
      archived: false,
      repeatSpawned: false
    });
    saveItems();
    return true;
  }

  /* Un-completing genuinely reverses the completion, so the next completion is
     a fresh event and is allowed to spawn again. Completing the same task
     twice in a row is impossible, and spawning is guarded by a check for an
     existing next occurrence, so duplicates cannot appear either way. */
  function toggleItem(id) {
    var item = findItem(id);
    if (!item) return;

    item.completed = !item.completed;

    if (item.completed) {
      recordCompletion();
      spawnNextOccurrence(item);
    }

    saveItems();
  }

  /* When a repeating task is completed, the following occurrence is inserted
     straight after it. Re-completing a task whose successor already exists is
     a no-op, so the list can never fill up with copies. */
  function spawnNextOccurrence(item) {
    if (!item.recurrence) return null;

    // Already followed by a copy of the same repeat: never spawn a second one.
    var index = state.items.indexOf(item);
    var following = state.items[index + 1];
    if (
      following &&
      following.recurrence === item.recurrence &&
      following.text === item.text &&
      following.dueDate === nextDueDate(item.recurrence, item.dueDate)
    ) {
      return null;
    }

    var nextDue = nextDueDate(item.recurrence, item.dueDate);
    var next = {
      id: createId(),
      text: item.text,
      completed: false,
      createdAt: Date.now(),
      dueDate: nextDue,
      category: item.category,
      priority: item.priority,
      reminder: shiftReminder(item.reminder, item.dueDate, nextDue),
      recurrence: item.recurrence,
      archived: false,
      repeatSpawned: false
    };

    state.items.splice(index + 1, 0, next);
    return next;
  }

  /* Editing never touches id, completed or createdAt, so re-ordering,
     completion and history all survive an edit. */
  function updateItem(id, rawText, rawDueDate, extras) {
    var item = findItem(id);
    if (!item) return;
    var text = String(rawText).replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
    if (!text) return;

    var dueDate = arguments.length > 2 ? normaliseDate(rawDueDate) : item.dueDate;
    var details = extras || {};
    var category = "category" in details ? normaliseCategory(details.category) : item.category;
    var priority = "priority" in details ? normalisePriority(details.priority) : item.priority;
    var reminder = "reminder" in details ? normaliseReminder(details.reminder) : item.reminder;
    var recurrence = "recurrence" in details ? normaliseRecurrence(details.recurrence) : item.recurrence;

    if (
      text === item.text &&
      dueDate === item.dueDate &&
      category === item.category &&
      priority === item.priority &&
      reminder === item.reminder &&
      recurrence === item.recurrence
    ) {
      return;
    }

    item.text = text;
    item.dueDate = dueDate;
    item.category = category;
    item.priority = priority;
    item.reminder = reminder;
    item.recurrence = recurrence;
    // Changing the repeat rule means the next completion should spawn afresh.
    item.repeatSpawned = false;
    saveItems();
  }

  /* --- Archive ---------------------------------------------------------- */

  function setArchived(id, archived) {
    var item = findItem(id);
    if (!item) return false;
    item.archived = Boolean(archived);
    saveItems();
    return true;
  }

  /* --- Undo ------------------------------------------------------------- */

  /* Holds the removed task(s) plus exactly where they were, so undo puts
     everything back untouched — id, order, completion and all fields. */
  var undoBuffer = null;
  var undoTimer = null;

  function showUndo(message, entries) {
    window.clearTimeout(undoTimer);
    undoBuffer = entries;
    els.undoMessage.textContent = message;
    els.undoToast.hidden = false;
    undoTimer = window.setTimeout(hideUndo, UNDO_MS);
  }

  function hideUndo() {
    window.clearTimeout(undoTimer);
    undoTimer = null;
    undoBuffer = null;
    if (els.undoToast) els.undoToast.hidden = true;
  }

  function undoLast() {
    if (!undoBuffer || !undoBuffer.length) return;
    var entries = undoBuffer;
    undoBuffer = null;
    window.clearTimeout(undoTimer);
    undoTimer = null;
    els.undoToast.hidden = true;

    // Restored in ascending index order so the original sequence is recreated.
    entries
      .slice()
      .sort(function (a, b) {
        return a.index - b.index;
      })
      .forEach(function (entry) {
        var at = Math.min(entry.index, state.items.length);
        state.items.splice(at, 0, entry.item);
      });

    saveItems();
    render();
    flashStatus("Task restored", true);
  }

  /* Moves a task one slot up or down in the master list. Returns true when
     something actually moved, so callers can skip a pointless re-render. */
  function moveItem(id, direction) {
    var index = -1;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) {
        index = i;
        break;
      }
    }
    if (index === -1) return false;

    var target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= state.items.length) return false;

    var moved = state.items.splice(index, 1)[0];
    state.items.splice(target, 0, moved);
    saveItems();
    return true;
  }

  /* Applies the order currently shown in the DOM after a drag. */
  function applyVisibleOrder() {
    if (state.filter !== "all" || state.search || state.category) {
      // Reordering a filtered or searched list would silently move hidden
      // tasks, so it is refused rather than done confusingly.
      return false;
    }

    var rows = els.list.querySelectorAll(".todo-item");
    if (!rows.length) return false;

    var order = [];
    for (var i = 0; i < rows.length; i++) {
      order.push(rows[i].dataset.id);
    }

    var reordered = state.items.slice().sort(function (a, b) {
      return order.indexOf(a.id) - order.indexOf(b.id);
    });

    var changed = reordered.some(function (item, index) {
      return state.items[index] !== item;
    });
    if (!changed) return false;

    state.items = reordered;
    saveItems();
    return true;
  }

  function setWorkspaceName(rawName) {
    var name = normaliseName(rawName);
    if (!name) return false;
    state.workspaceName = name;
    saveWorkspaceName(name);
    renderWorkspace();
    return true;
  }

  /* Returns the removed task together with its old position so the undo can
     put it back in exactly the right place. */
  function removeItem(id) {
    var index = -1;
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) index = i;
    }
    if (index === -1) return null;
    var removed = state.items.splice(index, 1)[0];
    saveItems();
    return { item: removed, index: index };
  }

  /* Returns one undo entry per removed task, each carrying its old position. */
  function clearCompleted() {
    var entries = [];
    state.items = state.items.filter(function (item, index) {
      if (!item.completed) return true;
      entries.push({ item: item, index: index });
      return false;
    });
    saveItems();
    return entries;
  }

  /* --- Rendering ------------------------------------------------------ */

  /* Search and the category filter narrow the list; the All/Active/Completed
     buttons then narrow whatever is left. All three combine. */
  function matchesSearch(item, query) {
    return item.text.toLowerCase().indexOf(query) !== -1;
  }

  function visibleItems() {
    var query = state.search.trim().toLowerCase();
    var category = state.category;

    // Archived tasks stay out of sight unless the Archived filter is chosen.
    if (state.filter === "archived") {
      return state.items.filter(function (item) {
        if (!item.archived) return false;
        if (query && item.text.toLowerCase().indexOf(query) === -1) return false;
        if (category && item.category !== category) return false;
        return true;
      });
    }

    return state.items.filter(function (item) {
      if (item.archived) return false;
      if (query && !matchesSearch(item, query)) return false;
      if (category && item.category !== category) return false;
      if (state.filter === "active" && item.completed) return false;
      if (state.filter === "completed" && !item.completed) return false;
      return true;
    });
  }

  /* --- Focus for today --------------------------------------------------- */

  /* Scores active tasks so the most deserving float to the top. Higher is more
     urgent. The `reasons` list doubles as the "why is this here" label. */
  function focusScore(item) {
    var today = todayIso();
    var score = 0;
    var reasons = [];

    if (item.dueDate) {
      if (item.dueDate < today) {
        score += 100;
        reasons.push("overdue");
      } else if (item.dueDate === today) {
        score += 80;
        reasons.push("due today");
      } else if (item.dueDate === toIsoDate(new Date(Date.now() + 86400000))) {
        score += 30;
        reasons.push("due tomorrow");
      }
    }

    if (item.priority === "high") {
      score += 40;
      reasons.push("high priority");
    } else if (item.priority === "medium") {
      score += 8;
    }

    if (item.reminder) {
      var when = reminderToDate(item.reminder);
      if (when && when.getTime() <= Date.now()) {
        score += 50;
        reasons.push("reminder due");
      } else if (when && when.getTime() - Date.now() < 86400000) {
        score += 20;
        reasons.push("reminder soon");
      }
    }

    return { score: score, reasons: reasons };
  }

  /* Only genuinely actionable tasks make the shortlist, so an empty Focus for
     Today really does mean "nothing pressing". */
  function focusCandidates() {
    var qualifying = ["overdue", "due today", "high priority", "reminder due"];

    return state.items
      .filter(function (item) {
        if (item.completed || item.archived) return false;
        var scored = focusScore(item);
        return scored.reasons.some(function (reason) {
          return qualifying.indexOf(reason) > -1;
        });
      })
      .map(function (item) {
        return { item: item, meta: focusScore(item) };
      })
      .sort(function (a, b) {
        if (b.meta.score !== a.meta.score) return b.meta.score - a.meta.score;
        // Original list order breaks ties, which keeps the shortlist stable.
        return state.items.indexOf(a.item) - state.items.indexOf(b.item);
      });
  }

  function buildItemElement(item) {
    var node = els.template.content.firstElementChild.cloneNode(true);
    var checkbox = node.querySelector(".todo-item__checkbox");
    var title = node.querySelector(".todo-item__title");
    var dueChip = node.querySelector(".todo-item__due");
    var categoryChip = node.querySelector(".todo-item__category");
    var priorityChip = node.querySelector(".todo-item__priority");
    var reminderChip = node.querySelector(".todo-item__reminder");
    var recurrenceChip = node.querySelector(".todo-item__recurrence");
    var archiveButton = node.querySelector(".icon-btn--archive");
    var dateButton = node.querySelector(".icon-btn--date");
    var editButton = node.querySelector(".icon-btn--edit");
    var deleteButton = node.querySelector(".icon-btn--danger");
    var moveButtons = node.querySelectorAll(".icon-btn--move");

    node.dataset.id = item.id;
    node.classList.toggle("is-done", item.completed);
    node.title = "Added " + formatDate(item.createdAt);

    // Dragging only makes sense on the unfiltered list, so the attribute is
    // simply absent otherwise and the handle is not interactive.
    if (state.filter === "all" && !state.search && !state.category) {
      node.draggable = true;
    }

    checkbox.checked = item.completed;
    checkbox.setAttribute("aria-label", "Mark \"" + item.text + "\" as complete");
    title.textContent = item.text;
    editButton.setAttribute("aria-label", "Edit \"" + item.text + "\"");
    deleteButton.setAttribute("aria-label", "Delete \"" + item.text + "\"");
    dateButton.setAttribute(
      "aria-label",
      item.dueDate
        ? "Change due date of \"" + item.text + "\", currently " + formatDueDate(item.dueDate)
        : "Add a due date to \"" + item.text + "\""
    );

    for (var i = 0; i < moveButtons.length; i++) {
      moveButtons[i].setAttribute("aria-label", (moveButtons[i].dataset.move === "up" ? "Move up: " : "Move down: ") + item.text);
    }

    var due = dueMeta(item);
    if (due) {
      dueChip.hidden = false;
      dueChip.textContent = due.label;
      // The chip's short label is visual shorthand, so the full sentence is
      // what assistive tech announces.
      dueChip.setAttribute("role", "img");
      dueChip.setAttribute("aria-label", due.accessible);
      // stateName is empty for ordinary future dates; classList.add("") throws.
      if (due.stateName) node.classList.add(due.stateName);
    }

    if (item.category && CATEGORIES[item.category]) {
      categoryChip.hidden = false;
      categoryChip.textContent = CATEGORIES[item.category];
      categoryChip.setAttribute("role", "img");
      categoryChip.setAttribute("aria-label", "Category: " + CATEGORIES[item.category]);
      node.dataset.category = item.category;
    }

    // Priority always renders, so "Medium" is visible on new tasks too.
    var priority = item.priority || DEFAULT_PRIORITY;
    priorityChip.hidden = false;
    priorityChip.textContent = PRIORITIES[priority];
    priorityChip.setAttribute("role", "img");
    priorityChip.setAttribute("aria-label", "Priority: " + PRIORITIES[priority]);
    node.classList.add("is-priority-" + priority);

    if (item.reminder) {
      var reminderDate = reminderToDate(item.reminder);
      var reminderLabel = formatReminder(item.reminder);
      reminderChip.hidden = false;
      reminderChip.textContent = "🔔 " + reminderLabel;
      reminderChip.setAttribute("role", "img");
      reminderChip.setAttribute(
        "aria-label",
        "Reminder set for " + (reminderDate ? formatDate(reminderDate.getTime()) : item.reminder)
      );
      if (reminderDate) {
        if (reminderDate.getTime() <= Date.now()) {
          node.classList.add("is-reminder-past");
        } else if (reminderDate.getTime() - Date.now() < 86400000) {
          node.classList.add("is-reminder-due");
        }
      }
    }

    if (item.recurrence && RECURRENCES[item.recurrence]) {
      node.classList.add("is-recurring");
      recurrenceChip.hidden = false;
      recurrenceChip.textContent = "↻ " + RECURRENCES[item.recurrence];
      recurrenceChip.setAttribute("role", "img");
      recurrenceChip.setAttribute("aria-label", "Repeats " + RECURRENCES[item.recurrence].toLowerCase());
    }

    if (item.archived) {
      node.classList.add("is-archived");
      checkbox.setAttribute("aria-label", "Un-complete \"" + item.text + "\"");
      archiveButton.setAttribute("aria-label", "Restore \"" + item.text + "\" from archive");
      archiveButton.title = "Restore task";
    }

    return node;
  }

  /* The personalised task-manager name is the visual headline; the "Daily Do"
     brand stays permanently in the bar above it. */
  function renderWorkspace() {
    if (!els.workspaceName) return;
    els.workspaceName.textContent = state.workspaceName || DEFAULT_WORKSPACE_NAME;
    document.title = state.workspaceName
      ? BRAND_NAME + " — " + state.workspaceName
      : BRAND_NAME;

    try {
      els.workspaceDate.textContent = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long"
      }).format(new Date());
    } catch (error) {
      els.workspaceDate.textContent = new Date().toDateString();
    }
  }

  function render() {
    var items = visibleItems();
    var fragment = document.createDocumentFragment();

    els.list.textContent = "";
    items.forEach(function (item) {
      fragment.appendChild(buildItemElement(item));
    });
    els.list.appendChild(fragment);

    renderMoveStates();
    renderEmptyState(items.length);
    renderCounter();
    renderFilters();
    renderStats();
    renderStreak();
    renderFocusToday();
    renderFocusMode();
    renderWorkspace();
    renderReminderNote();
  }

  /* The first task cannot move up and the last cannot move down. Disabling
     those buttons is what makes re-ordering usable without a mouse. */
  function renderMoveStates() {
    var rows = els.list.querySelectorAll(".todo-item");
    var canReorder = state.filter === "all" && !state.search && !state.category;

    for (var i = 0; i < rows.length; i++) {
      var up = rows[i].querySelector('[data-move="up"]');
      var down = rows[i].querySelector('[data-move="down"]');
      if (up) up.disabled = !canReorder || i === 0;
      if (down) down.disabled = !canReorder || i === rows.length - 1;
    }
  }

  function renderStats() {
    var total = state.items.length;
    var completed = state.items.filter(function (item) {
      return item.completed;
    }).length;
    var remaining = total - completed;
    var percent = total === 0 ? 0 : Math.round((completed / total) * 100);

    els.statTotal.textContent = String(total);
    els.statCompleted.textContent = String(completed);
    els.statRemaining.textContent = String(remaining);
    els.statPercent.textContent = percent + "%";
    els.statsFill.style.width = percent + "%";
    els.statsProgress.setAttribute("aria-valuenow", String(percent));
    els.statsProgress.setAttribute(
      "aria-valuetext",
      percent + "% complete — " + completed + " of " + total + " tasks done"
    );
  }

  function renderEmptyState(visibleCount) {
    if (visibleCount > 0) {
      els.empty.hidden = true;
      return;
    }

    // Reached only when the current filter has no matches.
    // The "all" filter can only be empty when there are no tasks at all.
    var empty;
    var searching = Boolean(state.search.trim());
    var filtering = state.filter !== "all";

    if (searching) {
      // A search that matches nothing is the most common reason for an empty
      // list, so it gets a message that points at the search box.
      empty =
        filtering || state.category ? EMPTY_STATES.noSearchResultsFiltered : EMPTY_STATES.noSearchResults;
    } else if (state.category) {
      empty = EMPTY_STATES.noCategoryResults;
    } else if (state.filter === "active") {
      empty = EMPTY_STATES.noActive;
    } else if (state.filter === "completed") {
      empty = EMPTY_STATES.noCompleted;
    } else {
      empty = EMPTY_STATES.noTasks;
    }

    els.empty.querySelector(".empty-state__icon").textContent = empty.icon;
    els.empty.querySelector(".empty-state__title").textContent = empty.title;
    els.empty.querySelector(".empty-state__text").textContent = empty.text;
    els.empty.hidden = false;

    // A small encouraging line whenever the list is genuinely clear, and never
    // when the list is merely filtered down to nothing.
    var cheer = els.emptyCheer;
    if (cheer) {
      var genuinelyClear =
        state.items.filter(function (item) {
          return !item.archived;
        }).length === 0;
      if (genuinelyClear) {
        cheer.textContent = CHEERS[state.items.length % CHEERS.length];
        cheer.hidden = false;
      } else {
        cheer.hidden = true;
      }
    }
  }

  function renderCounter() {
    var total = state.items.length;
    var remaining = state.items.filter(function (item) {
      return !item.completed;
    }).length;

    els.counter.textContent =
      remaining + " of " + total + " item" + (total === 1 ? "" : "s") + " left";
  }

  function renderFilters() {
    Array.prototype.forEach.call(els.filters.querySelectorAll(".filter"), function (button) {
      var isActive = button.dataset.filter === state.filter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    var hasCompleted = state.items.some(function (item) {
      return item.completed;
    });
    els.clearCompleted.disabled = !hasCompleted;

    // Keep the search box and the category select in step with state, which
    // also matters when another tab changes things.
    if (els.searchInput.value !== state.search) {
      els.searchInput.value = state.search;
    }
    els.searchClear.hidden = !state.search;
    if (els.categoryFilter.value !== state.category) {
      els.categoryFilter.value = state.category;
    }
  }

  function flashStatus(message, isSuccess) {
    els.status.textContent = message;
    els.status.classList.toggle("is-error", !isSuccess);
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(function () {
      els.status.textContent = "Saved locally";
      els.status.classList.remove("is-error");
    }, 2000);
  }

  /* --- Inline editing ------------------------------------------------- */

  /* Opens the row editor. `focusField` names which control to land on, so the
     calendar button jumps straight to the date and the pencil to the text. */
  function startEditing(listItem, focusField) {
    if (!listItem || listItem.querySelector(".todo-item__edit-input")) return;

    var item = findItem(listItem.dataset.id);
    if (!item) return;

    var label = listItem.querySelector(".todo-item__label");
    var editor = document.createElement("div");
    editor.className = "todo-item__editor";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "todo-item__edit-input";
    input.value = item.text;
    input.maxLength = MAX_LENGTH;
    input.setAttribute("aria-label", "Task title");

    var dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.className = "todo-item__edit-date";
    dateInput.value = item.dueDate;
    dateInput.setAttribute("aria-label", "Due date");

    var categoryInput = document.createElement("select");
    categoryInput.className = "form-select";
    categoryInput.setAttribute("aria-label", "Category");
    categoryInput.appendChild(buildOption("", "No category"));
    Object.keys(CATEGORIES).forEach(function (key) {
      categoryInput.appendChild(buildOption(key, CATEGORIES[key]));
    });
    categoryInput.value = item.category;

    var priorityInput = document.createElement("select");
    priorityInput.className = "form-select";
    priorityInput.setAttribute("aria-label", "Priority");
    Object.keys(PRIORITIES).forEach(function (key) {
      priorityInput.appendChild(buildOption(key, PRIORITIES[key]));
    });
    priorityInput.value = item.priority || DEFAULT_PRIORITY;

    var reminderInput = document.createElement("input");
    reminderInput.type = "datetime-local";
    reminderInput.className = "form-select";
    reminderInput.value = item.reminder;
    reminderInput.setAttribute("aria-label", "Reminder");

    var recurrenceInput = document.createElement("select");
    recurrenceInput.className = "form-select";
    recurrenceInput.setAttribute("aria-label", "Repeat");
    recurrenceInput.appendChild(buildOption("", "Never"));
    Object.keys(RECURRENCES).forEach(function (key) {
      recurrenceInput.appendChild(buildOption(key, RECURRENCES[key]));
    });
    recurrenceInput.value = item.recurrence;

    editor.appendChild(input);
    editor.appendChild(dateInput);
    editor.appendChild(categoryInput);
    editor.appendChild(priorityInput);
    editor.appendChild(reminderInput);
    editor.appendChild(recurrenceInput);

    label.hidden = true;
    listItem.insertBefore(editor, label);

    var fields = {
      text: input,
      date: dateInput,
      category: categoryInput,
      priority: priorityInput,
      reminder: reminderInput,
      recurrence: recurrenceInput
    };
    var target = fields[focusField] || input;
    target.focus();
    if (target === input) input.select();

    function stop(save) {
      if (input.dataset.finished === "true") return;
      input.dataset.finished = "true";

      var values = {
        text: input.value,
        due: dateInput.value,
        category: categoryInput.value,
        priority: priorityInput.value,
        reminder: reminderInput.value,
        recurrence: recurrenceInput.value
      };
      editor.remove();
      label.hidden = false;
      if (save) {
        updateItem(item.id, values.text, values.due, {
          category: values.category,
          priority: values.priority,
          reminder: values.reminder,
          recurrence: values.recurrence
        });
      }
      // render() rebuilds the list, so the row has to be looked up again.
      render();
      var next = els.list.querySelector('[data-id="' + item.id + '"] .icon-btn--edit');
      if (next) next.focus();
    }

    function onKeydown(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        stop(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        stop(false);
      }
    }

    function onBlur(event) {
      // Moving between the editor's own fields must not abort the edit.
      if (event.relatedTarget && editor.contains(event.relatedTarget)) return;
      stop(true);
    }

    var controls = [input, dateInput, categoryInput, priorityInput, reminderInput, recurrenceInput];
    controls.forEach(function (control) {
      control.addEventListener("keydown", onKeydown);
      control.addEventListener("blur", onBlur);
    });
  }

  function buildOption(value, label) {
    var option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  /* --- Events --------------------------------------------------------- */

  function readFormDetails() {
    return {
      category: els.category ? els.category.value : "",
      priority: els.priority ? els.priority.value : DEFAULT_PRIORITY,
      reminder: els.reminder ? els.reminder.value : "",
      recurrence: els.recurrence ? els.recurrence.value : ""
    };
  }

  /* Explains what a repeat will do, because "weekly" means little on its own. */
  function renderRecurrenceNote() {
    if (!els.recurrenceNote) return;
    var value = els.recurrence ? els.recurrence.value : "";
    var due = els.date ? els.date.value : "";
    if (!value) {
      els.recurrenceNote.textContent = "";
      return;
    }
    var next = nextDueDate(value, due);
    var when = next ? " Next one is due " + formatDueDate(next) + "." : "";
    els.recurrenceNote.textContent =
      "A new task is created" + when + " each time you complete this one.";
  }

  function handleSubmit(event) {
    event.preventDefault();
    var details = readFormDetails();
    var added = addItem(els.input.value, els.date.value, details);

    if (added) {
      els.input.value = "";
      // The date is kept so several tasks can be filed under the same day;
      // clearing the field adds a task with no due date.
      render();

      // Ask for notification permission only now, and only if a reminder was
      // actually chosen — never speculatively on page load.
      if (details.reminder) {
        requestNotificationPermission(function () {
          renderReminderNote();
          // Check straight away so a reminder that is already due fires now
          // rather than up to 30 seconds later.
          checkReminders();
        });
      }
    }
    els.input.focus();
  }

  function handleSearchInput() {
    state.search = els.searchInput.value;
    render();
  }

  function clearSearch() {
    state.search = "";
    els.searchInput.value = "";
    render();
    els.searchInput.focus();
  }

  function handleCategoryFilter() {
    state.category = normaliseCategory(els.categoryFilter.value);
    render();
  }

  function toggleTaskOptions() {
    var open = els.options.hidden;
    els.options.hidden = !open;
    els.toggleOptions.setAttribute("aria-expanded", String(open));
    if (open) {
      renderReminderNote();
      focusWhenReady(els.category);
    }
  }

  /* Bulk delete is the one action that can wipe several tasks at once, so it
     always confirms first. Only completed tasks are ever removed. */
  function handleClearCompleted() {
    var completedCount = state.items.filter(function (item) {
      return item.completed;
    }).length;
    if (!completedCount) return;

    confirmAction(
      "This permanently removes " +
        completedCount +
        " completed task" +
        (completedCount === 1 ? "" : "s") +
        ". Active tasks are kept.",
      "Remove " + completedCount
    ).then(function (confirmed) {
      if (!confirmed) return;
      var entries = clearCompleted();
      render();
      if (entries.length) {
        // Bulk clearing is undoable too, restoring every task and its position.
        showUndo("Removed " + entries.length + " completed task" + (entries.length === 1 ? "" : "s"), entries);
      }
    });
  }

  function handleFilterClick(event) {
    var button = event.target.closest(".filter");
    if (!button) return;
    state.filter = button.dataset.filter;
    render();
  }

  function handleListClick(event) {
    var listItem = event.target.closest(".todo-item");
    if (!listItem) return;

    // A drag ends with a click in some browsers; never let that toggle or
    // delete anything.
    if (draggedId) return;

    var moveButton = event.target.closest(".icon-btn--move");
    if (moveButton) {
      if (moveItem(listItem.dataset.id, moveButton.dataset.move)) {
        render();
        flashStatus("Task moved " + moveButton.dataset.move, true);
        focusRowButton(listItem.dataset.id, moveButton.dataset.move);
      }
      return;
    }

    if (event.target.closest(".icon-btn--danger")) {
      var removed = removeItem(listItem.dataset.id);
      if (removed) {
        render();
        // A single delete can be taken back for a few seconds.
        showUndo('Deleted "' + removed.item.text + '"', [removed]);
      }
    } else if (event.target.closest(".icon-btn--archive")) {
      var id = listItem.dataset.id;
      var task = findItem(id);
      var wasArchived = task ? task.archived : false;
      if (setArchived(id, !wasArchived)) {
        render();
        flashStatus(wasArchived ? "Task restored" : "Task archived", true);
      }
    } else if (event.target.closest(".icon-btn--date")) {
      startEditing(listItem, "date");
    } else if (event.target.closest(".icon-btn--edit")) {
      startEditing(listItem, "text");
    }
  }

  /* Keeps the keyboard position steady after a re-order, instead of dumping
     focus back to the top of the document. */
  function focusRowButton(id, direction) {
    var row = els.list.querySelector('[data-id="' + id + '"]');
    if (!row) return;
    var button = row.querySelector('[data-move="' + direction + '"]');
    if (button && !button.disabled) {
      button.focus();
      return;
    }
    // Now at the edge of the list, so focus the edit button instead.
    var fallback = row.querySelector(".icon-btn--edit");
    if (fallback) fallback.focus();
  }

  /* --- Drag and drop --------------------------------------------------- */

  function handleDragStart(event) {
    var listItem = event.target.closest(".todo-item");
    if (!listItem) return;
    if (state.filter !== "all" || state.search || state.category) return;

    draggedId = listItem.dataset.id;
    listItem.classList.add("is-dragging");

    var transfer = event.dataTransfer;
    if (transfer) {
      transfer.effectAllowed = "move";
      // Firefox refuses to start a drag unless some data is set.
      try {
        transfer.setData("text/plain", draggedId);
      } catch (error) {
        /* IE-only limitation */
      }
    }
  }

  function handleDragOver(event) {
    if (!draggedId) return;
    // Preventing the default is what marks this element as a valid drop target.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event) {
    if (!draggedId) return;
    event.preventDefault();

    var target = event.target.closest(".todo-item");
    if (!target || target.dataset.id === draggedId) return;

    var dragged = els.list.querySelector('[data-id="' + draggedId + '"]');
    if (!dragged) return;

    // Insert before or after depending on which half was hovered, so the row
    // lands where the pointer actually is.
    var rect = target.getBoundingClientRect();
    var after = event.clientY > rect.top + rect.height / 2;
    target.parentNode.insertBefore(dragged, after ? target.nextSibling : target);

    if (applyVisibleOrder()) {
      flashStatus("Order saved", true);
    }
    endDrag();
  }

  function endDrag() {
    var dragging = els.list.querySelector(".is-dragging");
    if (dragging) dragging.classList.remove("is-dragging");
    draggedId = null;
  }

  function handleDragEnd() {
    endDrag();
    // A cancelled drag must not leave the visual order ahead of the stored one.
    render();
  }

  function handleListChange(event) {
    var checkbox = event.target.closest(".todo-item__checkbox");
    if (!checkbox) return;
    toggleItem(checkbox.closest(".todo-item").dataset.id);
    render();
  }

  function handleListDoubleClick(event) {
    var title = event.target.closest(".todo-item__title");
    if (!title) return;
    startEditing(title.closest(".todo-item"));
  }

  function handleStorage(event) {
    if (event.key === ITEMS_KEY) {
      state.items = loadItems();
      render();
      return;
    }
    if (event.key === THEME_KEY) {
      applyTheme(loadTheme());
      return;
    }
    if (event.key === PROFILE_KEY) {
      var name = loadWorkspaceName();
      state.workspaceName = name;
      if (!name) {
        // The name was cleared in another tab: fall back to onboarding.
        showStep("name");
        showScreen(els.welcome);
        focusWhenReady(els.nameInput);
      } else {
        renderWorkspace();
      }
      return;
    }
    if (event.key === null) {
      state.items = loadItems();
      state.workspaceName = loadWorkspaceName();
      if (!state.workspaceName) {
        showStep("name");
        showScreen(els.welcome);
      }
      render();
    }
  }

  /* --- Onboarding ----------------------------------------------------- */

  function showStep(name) {
    var steps = els.welcomeSteps;
    for (var i = 0; i < steps.length; i++) {
      steps[i].hidden = steps[i].dataset.step !== name;
    }
    if (name === "ready") {
      els.welcomeName.textContent = state.workspaceName;
    }
  }

  function handleNameSubmit(event) {
    event.preventDefault();
    var name = normaliseName(els.nameInput.value);
    if (!name) {
      showNameError("Please give your task manager a name.");
      return;
    }
    if (!saveWorkspaceName(name)) {
      showNameError("Your browser is blocking storage, so the name cannot be saved.");
      return;
    }
    els.nameError.hidden = true;
    state.workspaceName = name;
    showStep("ready");
    focusWhenReady(els.startTask);
  }

  function showNameError(message) {
    els.nameError.textContent = message;
    els.nameError.hidden = false;
    els.nameInput.setAttribute("aria-invalid", "true");
    els.nameInput.focus();
  }

  /* --- Confirm dialog -------------------------------------------------- */

  /* Promise-based so the caller can `await` a yes/no without blocking. */
  function confirmAction(message, confirmLabel) {
    els.confirmMessage.textContent = message;
    els.confirmOk.textContent = confirmLabel || "Delete";
    els.confirmModal.hidden = false;
    lastFocused = document.activeElement;
    focusWhenReady(els.confirmOk);
    return new Promise(function (resolve) {
      confirmResolve = resolve;
    });
  }

  function closeConfirm(result) {
    els.confirmModal.hidden = true;
    if (lastFocused && lastFocused.isConnected) lastFocused.focus();
    var resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(result);
  }

  /* --- Backup ------------------------------------------------------------ */

  /* A plain JSON file the user can keep. Nothing leaves the browser. */
  function exportBackup() {
    var payload = {
      app: "Daily Do",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspaceName: state.workspaceName,
      theme: state.theme,
      streak: state.streak,
      items: state.items
    };

    try {
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "daily-do-backup-" + todayIso() + ".json";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Revoking immediately can cancel the download in some browsers.
      window.setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1000);
      showBackupStatus("Exported " + state.items.length + " tasks.", false);
    } catch (error) {
      console.warn("Export failed:", error);
      showBackupStatus("This browser could not create the download.", true);
    }
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (error) {
        showBackupStatus("That file is not valid JSON.", true);
        return;
      }

      var incoming = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(incoming)) {
        showBackupStatus("No tasks were found in that file.", true);
        return;
      }

      // loadItemsFromArray() sanitises every field, so a hand-edited file
      // cannot inject broken values into the app.
      var imported = sanitiseItems(incoming);
      var existing = {};
      state.items.forEach(function (item) {
        existing[item.id] = true;
      });

      var added = 0;
      imported.forEach(function (item) {
        if (existing[item.id]) return;
        state.items.push(item);
        added++;
      });

      if (parsed && typeof parsed.workspaceName === "string" && !state.workspaceName) {
        setWorkspaceName(parsed.workspaceName);
      }

      saveItems();
      render();
      showBackupStatus(
        added ? "Imported " + added + " task" + (added === 1 ? "" : "s") + "." : "Nothing new to import.",
        false
      );
    };
    reader.onerror = function () {
      showBackupStatus("That file could not be read.", true);
    };
    reader.readAsText(file);
  }

  function showBackupStatus(message, isError) {
    if (!els.backupStatus) return;
    els.backupStatus.textContent = message;
    els.backupStatus.hidden = false;
    els.backupStatus.classList.toggle("field-error", Boolean(isError));
  }

  /* --- Settings modal ------------------------------------------------- */

  function openSettings() {
    lastFocused = document.activeElement;
    els.settingsName.value = state.workspaceName;
    els.settingsError.hidden = true;
    els.settingsName.removeAttribute("aria-invalid");
    els.modal.hidden = false;
    focusWhenReady(els.settingsName);
    els.settingsName.select();
  }

  function closeSettings() {
    els.modal.hidden = true;
    if (lastFocused && lastFocused.isConnected) lastFocused.focus();
  }

  function handleSettingsSubmit(event) {
    event.preventDefault();
    var name = normaliseName(els.settingsName.value);
    if (!name) {
      els.settingsError.textContent = "Please enter a name.";
      els.settingsError.hidden = false;
      els.settingsName.setAttribute("aria-invalid", "true");
      els.settingsName.focus();
      return;
    }
    if (!setWorkspaceName(name)) {
      els.settingsError.textContent = "Your browser is blocking storage, so the name cannot be saved.";
      els.settingsError.hidden = false;
      return;
    }
    closeSettings();
    flashStatus("Task manager renamed", true);
  }

  /* Minimal focus trap so Tab cannot wander behind an open dialog. Shared by
     the settings and confirm dialogs. */
  function handleModalKeydown(event) {
    var modal = event.target.closest(".modal");
    if (!modal || modal.hidden) return;

    if (event.key === "Escape") {
      event.preventDefault();
      if (modal === els.confirmModal) {
        closeConfirm(false);
      } else {
        closeSettings();
      }
      return;
    }
    if (event.key !== "Tab") return;

    var focusable = modal.querySelectorAll("input, select, button");
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /* --- Init ----------------------------------------------------------- */

  function cacheElements() {
    els.splash = document.getElementById("splash");
    els.welcome = document.getElementById("welcome");
    els.app = document.getElementById("app");

    els.welcomeSteps = els.welcome.querySelectorAll(".welcome__step");
    els.nameForm = document.getElementById("name-form");
    els.nameInput = document.getElementById("name-input");
    els.nameError = document.getElementById("name-error");
    els.welcomeName = document.getElementById("welcome-name");
    els.startTask = document.getElementById("start-task");

    els.form = document.getElementById("todo-form");
    els.input = document.getElementById("todo-input");
    els.date = document.getElementById("todo-date");
    els.options = document.getElementById("task-options");
    els.toggleOptions = document.getElementById("toggle-options");
    els.category = document.getElementById("todo-category");
    els.priority = document.getElementById("todo-priority");
    els.reminder = document.getElementById("todo-reminder");
    els.recurrence = document.getElementById("todo-recurrence");
    els.recurrenceNote = document.getElementById("recurrence-note");
    els.reminderNote = document.getElementById("reminder-note");

    els.streak = document.getElementById("streak");
    els.streakText = document.getElementById("streak-text");
    els.emptyCheer = document.getElementById("empty-cheer");

    els.focusToday = document.getElementById("focus-today");
    els.focusTodaySummary = document.getElementById("focus-today-summary");
    els.focusTodayList = document.getElementById("focus-today-list");
    els.focusModeBtn = document.getElementById("focus-mode-btn");
    els.focusMode = document.getElementById("focus-mode");
    els.focusModeBody = document.getElementById("focus-mode-body");
    els.focusModeExit = document.getElementById("focus-mode-exit");

    els.undoToast = document.getElementById("undo-toast");
    els.undoMessage = document.getElementById("undo-message");
    els.undoButton = document.getElementById("undo-button");

    els.exportBtn = document.getElementById("export-btn");
    els.importBtn = document.getElementById("import-btn");
    els.importFile = document.getElementById("import-file");
    els.backupStatus = document.getElementById("backup-status");

    els.searchInput = document.getElementById("search-input");
    els.searchClear = document.getElementById("search-clear");
    els.categoryFilter = document.getElementById("category-filter");

    els.statTotal = document.getElementById("stat-total");
    els.statCompleted = document.getElementById("stat-completed");
    els.statRemaining = document.getElementById("stat-remaining");
    els.statPercent = document.getElementById("stat-percent");
    els.statsFill = document.getElementById("stats-fill");
    els.statsProgress = document.getElementById("stats-progress");

    els.list = document.getElementById("todo-list");
    els.empty = document.getElementById("empty-state");
    els.filters = document.getElementById("todo-filters");
    els.clearCompleted = document.getElementById("clear-completed");
    els.counter = document.getElementById("items-left");
    els.status = document.getElementById("save-status");
    els.template = document.getElementById("todo-item-template");
    els.workspaceName = document.getElementById("workspace-name");
    els.workspaceDate = document.getElementById("workspace-date");
    els.settingsBtn = document.getElementById("settings-btn");
    els.themeBtn = document.getElementById("theme-btn");

    els.confirmModal = document.getElementById("confirm-modal");
    els.confirmMessage = document.getElementById("confirm-message");
    els.confirmOk = document.getElementById("confirm-ok");
    els.confirmCancel = document.getElementById("confirm-cancel");
    els.confirmBackdrop = document.getElementById("confirm-backdrop");

    els.modal = document.getElementById("settings-modal");
    els.settingsForm = document.getElementById("settings-form");
    els.settingsName = document.getElementById("settings-name");
    els.settingsError = document.getElementById("settings-error");
    els.settingsCancel = document.getElementById("settings-cancel");
    els.settingsBackdrop = document.getElementById("settings-backdrop");
  }

  function bindEvents() {
    els.form.addEventListener("submit", handleSubmit);
    els.filters.addEventListener("click", handleFilterClick);
    els.list.addEventListener("click", handleListClick);
    els.list.addEventListener("change", handleListChange);
    els.list.addEventListener("dblclick", handleListDoubleClick);

    els.list.addEventListener("dragstart", handleDragStart);
    els.list.addEventListener("dragover", handleDragOver);
    els.list.addEventListener("drop", handleDrop);
    els.list.addEventListener("dragend", handleDragEnd);

    els.searchInput.addEventListener("input", handleSearchInput);
    els.searchClear.addEventListener("click", clearSearch);
    els.categoryFilter.addEventListener("change", handleCategoryFilter);
    els.toggleOptions.addEventListener("click", toggleTaskOptions);
    els.reminder.addEventListener("input", renderReminderNote);
    els.reminder.addEventListener("change", renderReminderNote);
    els.recurrence.addEventListener("change", renderRecurrenceNote);

    els.undoButton.addEventListener("click", undoLast);

    els.focusModeBtn.addEventListener("click", function () {
      if (state.focusMode) {
        exitFocusMode();
      } else {
        enterFocusMode();
      }
    });
    els.focusModeExit.addEventListener("click", exitFocusMode);

    els.exportBtn.addEventListener("click", exportBackup);
    els.importBtn.addEventListener("click", function () {
      els.importFile.click();
    });
    els.importFile.addEventListener("change", function () {
      var file = els.importFile.files && els.importFile.files[0];
      if (file) importBackup(file);
      // Reset so re-picking the same file fires a change event again.
      els.importFile.value = "";
    });

    els.clearCompleted.addEventListener("click", handleClearCompleted);
    els.themeBtn.addEventListener("click", toggleTheme);

    // Only follow the OS live while the user has not made an explicit choice.
    if (window.matchMedia) {
      var scheme = window.matchMedia("(prefers-color-scheme: dark)");
      var onSchemeChange = function () {
        if (state.theme === "system") applyTheme("system");
      };
      if (scheme.addEventListener) {
        scheme.addEventListener("change", onSchemeChange);
      } else if (scheme.addListener) {
        scheme.addListener(onSchemeChange);
      }
    }

    els.nameForm.addEventListener("submit", handleNameSubmit);
    els.nameInput.addEventListener("input", function () {
      els.nameError.hidden = true;
      els.nameInput.removeAttribute("aria-invalid");
    });
    els.startTask.addEventListener("click", function () {
      showScreen(els.app);
      render();
      focusWhenReady(els.input);
      startReminderLoop();
    });

    els.settingsBtn.addEventListener("click", openSettings);
    els.settingsForm.addEventListener("submit", handleSettingsSubmit);
    els.settingsCancel.addEventListener("click", closeSettings);
    els.settingsBackdrop.addEventListener("click", closeSettings);
    els.settingsName.addEventListener("input", function () {
      els.settingsError.hidden = true;
      els.settingsName.removeAttribute("aria-invalid");
    });

    els.confirmOk.addEventListener("click", function () {
      closeConfirm(true);
    });
    els.confirmCancel.addEventListener("click", function () {
      closeConfirm(false);
    });
    els.confirmBackdrop.addEventListener("click", function () {
      closeConfirm(false);
    });

    // One delegated listener covers both dialogs.
    document.addEventListener("keydown", handleModalKeydown);

    window.addEventListener("storage", handleStorage);
  }

  /* Splash -> (welcome) -> app. The timer is the only thing that drives the
     transition, so nothing here depends on the user clicking. */
  function startFlow() {
    state.items = loadItems();
    state.workspaceName = loadWorkspaceName();
    // A missed day resets the streak, so it is checked on every load.
    state.streak = loadStreak();
    refreshStreak();

    // Applied before the first paint of the app so the theme never flashes.
    applyTheme(loadTheme());

    render();

    var hasName = Boolean(state.workspaceName);
    if (hasName) {
      showStep("ready");
    } else {
      showStep("name");
    }

    currentScreen = els.splash;
    els.splash.hidden = false;
    els.splash.removeAttribute("inert");

    // Keep the splash clickable as a skip, but the timer alone is enough.
    els.splash.addEventListener("click", advanceFromSplash);

    var wait = prefersReducedMotion() ? REDUCED_SPLASH_MS : SPLASH_MS;
    screenTimer = window.setTimeout(advanceFromSplash, wait);
  }

  function advanceFromSplash() {
    if (screenTimer === null) return;
    window.clearTimeout(screenTimer);
    screenTimer = null;

    if (state.workspaceName) {
      showScreen(els.app);
      render();
      focusWhenReady(els.input);
      // Reminders only make sense once the app is actually on screen.
      startReminderLoop();
    } else {
      showStep("name");
      showScreen(els.welcome);
      focusWhenReady(els.nameInput);
    }
  }

  function init() {
    cacheElements();
    if (!els.splash || !els.welcome || !els.app) {
      console.error("Daily Do could not start: expected screen elements are missing.");
      return;
    }
    bindEvents();
    startFlow();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
