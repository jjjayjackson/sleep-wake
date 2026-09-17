const STORAGE_KEY = "sleep-wake.events";
const EDGE_WIDTH = 24;
const OPEN_THRESHOLD = 72;
const DELETE_THRESHOLD = 80;
const LONG_PRESS_MS = 1400;
const MOVE_CANCEL_PX = 12;

const chooser = document.getElementById("chooser");
const active = document.getElementById("active");
const statusEl = document.getElementById("status");
const iconSleep = document.getElementById("icon-sleep");
const iconAwake = document.getElementById("icon-awake");
const timeEl = document.getElementById("time");
const switchBtn = document.getElementById("switch");
const historyEl = document.getElementById("history");
const historyList = document.getElementById("history-list");
const scrim = document.getElementById("scrim");
const editor = document.getElementById("editor");
const editorState = document.getElementById("editor-state");
const editorTime = document.getElementById("editor-time");
const editorError = document.getElementById("editor-error");
const historyClear = document.getElementById("history-clear");
const historyFooter = document.getElementById("history-footer");

let events = loadEvents();
let tickId = null;
let historyOpen = false;
let historyWidth = 0;
let suppressClick = false;
let suppressClickTimer = null;

function armClickSuppress() {
  suppressClick = true;
  clearTimeout(suppressClickTimer);
  suppressClickTimer = setTimeout(() => {
    suppressClick = false;
  }, 400);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function loadEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && (item.state === "sleep" || item.state === "awake") && Number.isFinite(item.at))
      .map((item) => ({
        id: String(item.id ?? item.at),
        state: item.state,
        at: Number(item.at),
      }))
      .sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

function saveEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function currentEvent() {
  return events[events.length - 1] ?? null;
}

function mode() {
  return currentEvent()?.state ?? null;
}

function elapsedMs(now = Date.now()) {
  const current = currentEvent();
  if (!current) return 0;
  return Math.max(0, now - current.at);
}

function formatTimer(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function formatClock(ts) {
  const date = new Date(ts);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDateLabel(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function dateKey(ts) {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatGap(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}m`;
  return `${totalSeconds}s`;
}

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function switchTo(kind) {
  const current = currentEvent();
  if (current && current.state === kind) return;

  events.push({
    id: newId(),
    state: kind,
    at: Date.now(),
  });
  saveEvents();
  render();
  scheduleTick();
}

function isValidTimestamp(index, nextAt) {
  const previous = events[index - 1];
  const next = events[index + 1];
  if (previous && nextAt <= previous.at) return false;
  if (next && nextAt >= next.at) return false;
  return true;
}

function applyTimestamp(index, nextAt) {
  if (!isValidTimestamp(index, nextAt)) return false;
  events[index] = { ...events[index], at: nextAt };
  events.sort((a, b) => a.at - b.at);
  saveEvents();
  render();
  scheduleTick();
  return true;
}

function persistEvents() {
  saveEvents();
  closeEditor();
  render();
  scheduleTick();
}

function deleteEvent(id) {
  events = events.filter((event) => event.id !== id);
  persistEvents();
}

function clearHistory() {
  events = [];
  persistEvents();
}

function renderMain() {
  const current = currentEvent();
  if (!current) {
    chooser.hidden = false;
    active.hidden = true;
    return;
  }

  chooser.hidden = true;
  active.hidden = false;

  const sleeping = current.state === "sleep";
  iconSleep.hidden = !sleeping;
  iconAwake.hidden = sleeping;
  statusEl.setAttribute("aria-label", sleeping ? "Sleeping" : "Awake");
  timeEl.textContent = formatTimer(elapsedMs());
  switchBtn.textContent = sleeping ? "AWAKE" : "SLEEP";
}

function renderHistory() {
  historyList.replaceChildren();
  historyFooter.hidden = events.length === 0;

  if (!events.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No state changes yet";
    historyList.append(empty);
    return;
  }

  let lastKey = null;
  events.forEach((event, index) => {
    const key = dateKey(event.at);
    if (key !== lastKey) {
      const heading = document.createElement("h2");
      heading.className = "history-date";
      heading.textContent = formatDateLabel(event.at);
      historyList.append(heading);
      lastKey = key;
    }

    const item = document.createElement("div");
    item.className = "history-item";

    const row = document.createElement("p");
    row.className = "history-event";
    const label = event.state === "sleep" ? "Sleep" : "Awake";
    row.textContent = `${label} — ${formatClock(event.at)}`;
    const isLatest = index === events.length - 1;
    if (isLatest) row.classList.add("is-latest");
    item.append(row);
    bindHistoryRow(item, row, event.id, isLatest);
    historyList.append(item);

    const gap = document.createElement("p");
    gap.className = "history-gap";
    if (isLatest) {
      gap.textContent = "ongoing";
    } else {
      gap.textContent = formatGap(events[index + 1].at - event.at);
    }
    historyList.append(gap);
  });
}

function render() {
  renderMain();
  renderHistory();
}

function scheduleTick() {
  clearTimeout(tickId);
  if (!mode()) return;

  const msIntoSecond = elapsedMs() % 1000;
  const delay = Math.max(16, 1000 - msIntoSecond);
  tickId = setTimeout(() => {
    renderMain();
    scheduleTick();
  }, delay);
}

function setHistoryOpen(open, { animate = true } = {}) {
  historyOpen = open;
  historyEl.classList.toggle("is-animating", animate);
  historyEl.classList.toggle("is-open", open);
  historyEl.style.transform = "";
  historyEl.setAttribute("aria-hidden", open ? "false" : "true");
  scrim.hidden = !open;
  document.body.classList.toggle("history-open", open);
  if (open) {
    requestAnimationFrame(() => {
      historyList.scrollTop = historyList.scrollHeight;
    });
  }
}

function bindDrawer() {
  let drag = null;

  function startDrag(event, fromOpen) {
    if (editor.hidden === false) return;
    historyWidth = historyEl.getBoundingClientRect().width || 1;
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      fromOpen,
      axis: null,
      moved: false,
    };
    if (!fromOpen) {
      historyEl.classList.remove("is-animating", "is-open");
      scrim.hidden = false;
    }
  }

  function onOpenPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (historyOpen || editor.hidden === false) return;
    if (event.clientX > EDGE_WIDTH) return;
    startDrag(event, false);
    event.preventDefault();
  }

  historyEl.addEventListener("pointerdown", (event) => {
    if (!historyOpen || editor.hidden === false) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target.closest(".history-item, .history-clear")) return;
    startDrag(event, true);
  });

  window.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.axis) {
      if (Math.abs(dx) < MOVE_CANCEL_PX && Math.abs(dy) < MOVE_CANCEL_PX) return;
      drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (drag.axis === "y") {
        drag = null;
        if (!historyOpen) setHistoryOpen(false, { animate: false });
        return;
      }
      drag.moved = true;
      historyEl.classList.remove("is-animating", "is-open");
      document.body.classList.add("history-open");
      scrim.hidden = false;
    }

    const x = drag.fromOpen ? historyWidth + dx : dx;
    const progress = Math.max(0, Math.min(1, x / historyWidth));
    historyEl.style.transform = `translateX(${(progress - 1) * 100}%)`;
    event.preventDefault();
  }, { passive: false });

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.startX;
    const x = drag.fromOpen ? historyWidth + dx : dx;
    const shouldOpen = drag.moved ? x > OPEN_THRESHOLD : drag.fromOpen;
    if (drag.moved) armClickSuppress();
    drag = null;
    setHistoryOpen(shouldOpen);
  }

  window.addEventListener("pointerup", finishDrag);
  window.addEventListener("pointercancel", finishDrag);

  document.getElementById("edge").addEventListener("pointerdown", onOpenPointerDown);

  document.getElementById("history-notch").addEventListener("click", (event) => {
    event.preventDefault();
    setHistoryOpen(true);
  });

  scrim.addEventListener("click", () => {
    setHistoryOpen(false);
  });

  historyEl.addEventListener("transitionend", () => {
    historyEl.classList.remove("is-animating");
  });
}

function bindHistoryRow(item, row, id, isLatest) {
  let gesture = null;
  let pressTimer = null;

  function stopPress() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    row.classList.remove("is-pressing");
  }

  item.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    gesture = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      axis: null,
    };
    if (isLatest) {
      row.classList.add("is-pressing");
      pressTimer = setTimeout(() => {
        pressTimer = null;
        gesture = null;
        item.style.transform = "";
        item.classList.remove("is-swiping", "is-settling");
        row.classList.remove("is-pressing");
        armClickSuppress();
        const index = events.findIndex((event) => event.id === id);
        if (index >= 0) openEditor(index);
      }, LONG_PRESS_MS);
    }
  });

  item.addEventListener("pointermove", (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;

    if (!gesture.axis) {
      if (Math.abs(dx) < MOVE_CANCEL_PX && Math.abs(dy) < MOVE_CANCEL_PX) return;
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (gesture.axis === "y") {
        stopPress();
        gesture = null;
        return;
      }
      stopPress();
      item.classList.add("is-swiping");
      item.classList.remove("is-settling");
    }

    gesture.dx = dx;
    item.style.transform = `translateX(${Math.min(0, dx)}px)`;
    event.preventDefault();
  });

  function endGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const shouldDelete = gesture.axis === "x" && gesture.dx <= -DELETE_THRESHOLD;
    stopPress();
    const ended = gesture;
    gesture = null;
    item.classList.remove("is-swiping");

    if (shouldDelete) {
      deleteEvent(id);
      return;
    }

    if (ended.axis === "x") {
      item.classList.add("is-settling");
      item.style.transform = "";
    }
  }

  item.addEventListener("pointerup", endGesture);
  item.addEventListener("pointercancel", endGesture);
}

function openEditor(index) {
  const event = events[index];
  if (!event) return;
  editor.dataset.index = String(index);
  editorState.textContent = event.state === "sleep" ? "Sleep" : "Awake";
  editorTime.textContent = formatClock(event.at);
  editorError.hidden = true;
  editor.hidden = false;
}

function closeEditor() {
  editor.hidden = true;
  editorError.hidden = true;
}

function changeLatestToNow() {
  const index = Number(editor.dataset.index);
  const ok = applyTimestamp(index, Date.now());
  if (!ok) {
    editorError.hidden = false;
    editorError.textContent = "That time would conflict with another event.";
    return;
  }
  closeEditor();
}

document.getElementById("choose-sleep").addEventListener("click", () => {
  switchTo("sleep");
});

document.getElementById("choose-awake").addEventListener("click", () => {
  switchTo("awake");
});

switchBtn.addEventListener("click", () => {
  switchTo(mode() === "sleep" ? "awake" : "sleep");
});

document.getElementById("editor-now").addEventListener("click", changeLatestToNow);
document.getElementById("editor-cancel").addEventListener("click", closeEditor);
historyClear.addEventListener("click", clearHistory);

editor.addEventListener("click", (event) => {
  if (event.target === editor) closeEditor();
});

document.addEventListener("click", (event) => {
  if (!suppressClick) return;
  if (event.target.closest("#history-clear")) {
    suppressClick = false;
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  suppressClick = false;
  clearTimeout(suppressClickTimer);
}, true);

document.addEventListener("contextmenu", (event) => {
  if (event.target.closest(".history-event, .edge, .history")) {
    event.preventDefault();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    renderMain();
    scheduleTick();
  }
});

bindDrawer();
render();
scheduleTick();
