/**
 * Todo List — application logic
 *
 * Plain JavaScript, no dependencies, no build step.
 * State lives in memory and is mirrored to localStorage after every change.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "todoList.items.v1";
  var MAX_LENGTH = 200;

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
    }
  };

  var els = {};
  var state = { items: [], filter: "all" };
  var statusTimer = null;

  /* --- Storage -------------------------------------------------------- */

  function createId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function loadItems() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
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
            createdAt: Number(item.createdAt) || Date.now()
          };
        });
    } catch (error) {
      console.warn("Could not read saved tasks:", error);
      return [];
    }
  }

  function saveItems() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items));
      flashStatus("Saved locally", true);
      return true;
    } catch (error) {
      console.warn("Could not save tasks:", error);
      flashStatus("Could not save in this browser", false);
      return false;
    }
  }

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  /* --- Data operations ------------------------------------------------ */

  function addItem(rawText) {
    var text = String(rawText).replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
    if (!text) return false;

    state.items.push({
      id: createId(),
      text: text,
      completed: false,
      createdAt: Date.now()
    });
    saveItems();
    return true;
  }

  function toggleItem(id) {
    var item = findItem(id);
    if (!item) return;
    item.completed = !item.completed;
    saveItems();
  }

  function updateItem(id, rawText) {
    var item = findItem(id);
    if (!item) return;
    var text = String(rawText).replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
    if (!text || text === item.text) return;
    item.text = text;
    saveItems();
  }

  function removeItem(id) {
    state.items = state.items.filter(function (item) {
      return item.id !== id;
    });
    saveItems();
  }

  function clearCompleted() {
    state.items = state.items.filter(function (item) {
      return !item.completed;
    });
    saveItems();
  }

  /* --- Rendering ------------------------------------------------------ */

  function visibleItems() {
    if (state.filter === "active") {
      return state.items.filter(function (item) {
        return !item.completed;
      });
    }
    if (state.filter === "completed") {
      return state.items.filter(function (item) {
        return item.completed;
      });
    }
    return state.items.slice();
  }

  function buildItemElement(item) {
    var node = els.template.content.firstElementChild.cloneNode(true);
    var label = node.querySelector(".todo-item__label");
    var checkbox = node.querySelector(".todo-item__checkbox");
    var title = node.querySelector(".todo-item__title");
    var editButton = node.querySelector(".icon-btn--edit");
    var deleteButton = node.querySelector(".icon-btn--danger");

    node.dataset.id = item.id;
    node.classList.toggle("is-done", item.completed);
    node.title = "Added " + formatDate(item.createdAt);

    checkbox.checked = item.completed;
    checkbox.setAttribute("aria-label", "Mark \"" + item.text + "\" as complete");
    title.textContent = item.text;
    editButton.setAttribute("aria-label", "Edit \"" + item.text + "\"");
    deleteButton.setAttribute("aria-label", "Delete \"" + item.text + "\"");

    return node;
  }

  function render() {
    var items = visibleItems();
    var fragment = document.createDocumentFragment();

    els.list.textContent = "";
    items.forEach(function (item) {
      fragment.appendChild(buildItemElement(item));
    });
    els.list.appendChild(fragment);

    renderEmptyState(items.length);
    renderCounter();
    renderFilters();
  }

  function renderEmptyState(visibleCount) {
    if (visibleCount > 0) {
      els.empty.hidden = true;
      return;
    }

    // Reached only when the current filter has no matches.
    // The "all" filter can only be empty when there are no tasks at all.
    var empty;
    if (state.filter === "active") {
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

  /* --- Inline editing ------------------------------------------------- */

  function startEditing(listItem) {
    if (!listItem || listItem.querySelector(".todo-item__edit-input")) return;

    var item = findItem(listItem.dataset.id);
    if (!item) return;

    var label = listItem.querySelector(".todo-item__label");
    var input = document.createElement("input");
    input.type = "text";
    input.className = "todo-item__edit-input";
    input.value = item.text;
    input.maxLength = MAX_LENGTH;
    input.setAttribute("aria-label", "Edit task");

    label.hidden = true;
    listItem.insertBefore(input, label.nextSibling);
    input.focus();
    input.select();

    function stop(save) {
      if (input.dataset.finished === "true") return;
      input.dataset.finished = "true";

      var value = input.value;
      input.remove();
      label.hidden = false;
      if (save) {
        updateItem(item.id, value);
        render();
      }
    }

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        stop(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        stop(false);
      }
    });
    input.addEventListener("blur", function () {
      stop(true);
    });
  }

  /* --- Events --------------------------------------------------------- */

  function handleSubmit(event) {
    event.preventDefault();
    var added = addItem(els.input.value);
    if (added) {
      els.input.value = "";
      render();
    }
    els.input.focus();
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

    if (event.target.closest(".icon-btn--danger")) {
      removeItem(listItem.dataset.id);
      render();
      flashStatus("Task deleted", true);
    } else if (event.target.closest(".icon-btn--edit")) {
      startEditing(listItem);
    }
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
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    state.items = loadItems();
    render();
  }

  /* --- Init ----------------------------------------------------------- */

  function init() {
    els.form = document.getElementById("todo-form");
    els.input = document.getElementById("todo-input");
    els.list = document.getElementById("todo-list");
    els.empty = document.getElementById("empty-state");
    els.filters = document.getElementById("todo-filters");
    els.clearCompleted = document.getElementById("clear-completed");
    els.counter = document.getElementById("items-left");
    els.status = document.getElementById("save-status");
    els.template = document.getElementById("todo-item-template");

    state.items = loadItems();

    els.form.addEventListener("submit", handleSubmit);
    els.filters.addEventListener("click", handleFilterClick);
    els.list.addEventListener("click", handleListClick);
    els.list.addEventListener("change", handleListChange);
    els.list.addEventListener("dblclick", handleListDoubleClick);
    els.clearCompleted.addEventListener("click", function () {
      clearCompleted();
      render();
    });
    window.addEventListener("storage", handleStorage);

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
