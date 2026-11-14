'use strict';

// New tab page: shows your promises, asks for check ins, and shows history.

const CHECK_ICON = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"></path></svg>';
const CROSS_ICON = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
const REFRESH_INTERVAL_MS = 30 * 1000;
const HISTORY_WEEK_COUNT = 6;

let appState = null;
let currentView = 'today';
let noteInstanceId = '';
let retirePromiseId = '';

const todayView = document.getElementById('view-today');
const historyView = document.getElementById('view-history');
const promiseDialog = document.getElementById('promise-dialog');
const noteDialog = document.getElementById('note-dialog');
const retireDialog = document.getElementById('retire-dialog');

// ---------- Small DOM helpers ----------

function createNode(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function createButton(label, className, onClick) {
  const button = createNode('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function createDot(status) {
  const dot = createNode('span', 'dot');
  if (status === 'kept') {
    dot.classList.add('dot-kept');
    dot.innerHTML = CHECK_ICON;
  } else if (status === 'broken') {
    dot.classList.add('dot-broken');
    dot.innerHTML = CROSS_ICON;
  } else if (status === 'pending') {
    dot.classList.add('dot-pending');
  } else {
    dot.classList.add('dot-empty');
  }
  return dot;
}

function describeDotStatus(status) {
  if (status === 'kept') {
    return 'kept';
  }
  if (status === 'broken') {
    return 'broken';
  }
  if (status === 'pending') {
    return 'waiting for your answer';
  }
  return 'nothing recorded';
}

// ---------- Loading and saving ----------

async function refresh() {
  appState = await PK.loadState();
  const changed = PK.syncInstances(appState, Date.now());
  if (changed) {
    await PK.saveState(appState);
  }
  PK.applyTheme(appState.settings.theme);
  render();
}

async function saveAndRender() {
  await PK.saveState(appState);
  render();
}

// ---------- Actions ----------

async function markKept(instanceId) {
  PK.resolveInstance(appState, instanceId, 'kept', '', Date.now());
  await saveAndRender();
}

function openNoteDialog(instanceId) {
  const instance = PK.findInstance(appState, instanceId);
  const promise = PK.findPromise(appState, instance.promiseId);
  noteInstanceId = instanceId;
  document.getElementById('note-promise-text').textContent = promise.text;
  document.getElementById('note-text').value = '';
  document.getElementById('note-error').textContent = '';
  noteDialog.showModal();
}

function openRetireDialog(promiseId) {
  const promise = PK.findPromise(appState, promiseId);
  retirePromiseId = promiseId;
  document.getElementById('retire-promise-text').textContent = promise.text;
  retireDialog.showModal();
}

function openPromiseDialog() {
  const form = document.getElementById('promise-form');
  form.reset();
  document.getElementById('promise-due-date').value = PK.toDateKey(new Date());
  document.getElementById('promise-error').textContent = '';
  updateDueDateVisibility();
  promiseDialog.showModal();
}

function getSelectedSchedule() {
  const checkedInput = document.querySelector('input[name="schedule"]:checked');
  return checkedInput.value;
}

function updateDueDateVisibility() {
  const dueDateField = document.getElementById('due-date-field');
  if (getSelectedSchedule() === 'once') {
    dueDateField.classList.remove('hidden');
  } else {
    dueDateField.classList.add('hidden');
  }
}

function validatePromiseFields(fields, now) {
  if (PK.getActivePromises(appState).length >= PK.MAX_ACTIVE_PROMISES) {
    return 'All three slots are in use. Keep, break, or retire a promise first.';
  }
  if (!fields.text) {
    return 'Write your promise first.';
  }
  if (!fields.deadlineTime) {
    return 'Choose a deadline time.';
  }
  if (fields.schedule === 'once') {
    if (!fields.dueDateKey) {
      return 'Choose a due date.';
    }
    const dueAt = PK.buildTimestamp(fields.dueDateKey, fields.deadlineTime);
    if (dueAt <= now) {
      return 'That deadline has already passed. Choose a later date or time.';
    }
  }
  if (fields.reminderTime && fields.reminderTime >= fields.deadlineTime) {
    return 'Set the reminder earlier than the deadline, or clear it.';
  }
  return '';
}

async function submitPromiseForm(event) {
  event.preventDefault();
  const now = Date.now();
  const fields = {
    text: document.getElementById('promise-text').value.trim(),
    why: document.getElementById('promise-why').value.trim(),
    schedule: getSelectedSchedule(),
    dueDateKey: document.getElementById('promise-due-date').value,
    deadlineTime: document.getElementById('promise-deadline').value,
    reminderTime: document.getElementById('promise-reminder').value
  };

  const errorMessage = validatePromiseFields(fields, now);
  if (errorMessage) {
    document.getElementById('promise-error').textContent = errorMessage;
    return;
  }

  PK.createPromise(appState, fields, now);
  promiseDialog.close();
  await saveAndRender();
}

async function submitNoteForm(event) {
  event.preventDefault();
  const note = document.getElementById('note-text').value.trim();
  if (!note) {
    document.getElementById('note-error').textContent = 'Add a short note first. One sentence is enough.';
    return;
  }
  PK.resolveInstance(appState, noteInstanceId, 'broken', note, Date.now());
  noteDialog.close();
  await saveAndRender();
}

async function submitRetireForm(event) {
  event.preventDefault();
  PK.retirePromise(appState, retirePromiseId, Date.now());
  retireDialog.close();
  await saveAndRender();
}

async function cycleTheme() {
  const currentTheme = appState.settings.theme;
  let nextTheme = 'auto';
  if (currentTheme === 'auto') {
    nextTheme = 'light';
  } else if (currentTheme === 'light') {
    nextTheme = 'dark';
  }
  appState.settings.theme = nextTheme;
  PK.applyTheme(nextTheme);
  await saveAndRender();
}

function showView(viewName) {
  currentView = viewName;
  render();
}

// ---------- Rendering: today ----------

function buildCheckInButtons(instanceId, keptLabel, brokenLabel, compact) {
  const buttonRow = createNode('div', 'button-row');
  let sizeClass = '';
  if (compact) {
    sizeClass = ' button-compact';
  }
  const keptButton = createButton(keptLabel, 'button button-primary' + sizeClass, function () {
    markKept(instanceId);
  });
  const brokenButton = createButton(brokenLabel, 'button' + sizeClass, function () {
    openNoteDialog(instanceId);
  });
  buttonRow.appendChild(keptButton);
  buttonRow.appendChild(brokenButton);
  return buttonRow;
}

function buildWeekRow(promise, now) {
  const weekRow = createNode('div', 'week-row');
  for (const day of PK.getWeekRow(appState, promise, now)) {
    const dayNode = createNode('div', 'week-day');
    let label = day.label;
    if (day.isToday) {
      dayNode.classList.add('is-today');
      label = 'Today';
    }
    const dot = createDot(day.status);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', day.label + ': ' + describeDotStatus(day.status));
    dayNode.appendChild(dot);
    dayNode.appendChild(createNode('span', '', label));
    weekRow.appendChild(dayNode);
  }
  return weekRow;
}

function buildOverdueCard(instance, promise) {
  const card = createNode('section', 'card card-centered');
  const passedText = 'The deadline passed ' + PK.formatShortDate(instance.dueAt) + ' at ' + PK.formatClockTime(instance.dueAt);
  card.appendChild(createNode('span', 'pill pill-broken', passedText));
  card.appendChild(createNode('h1', 'question-text', 'Did you keep it?'));
  card.appendChild(createNode('p', 'promise-text-medium muted', promise.text));
  card.appendChild(buildCheckInButtons(instance.id, 'Yes, I kept it', 'No, I broke it', false));
  card.appendChild(createNode('p', 'small muted', 'No rush. Your browser works as usual, and this will wait here until you answer.'));
  return card;
}

function buildFocusCard(instance, promise, now) {
  const card = createNode('section', 'card');

  const topRow = createNode('div', 'card-row');
  topRow.appendChild(createNode('span', 'small muted', 'You promised yourself'));
  const topRight = createNode('div', 'card-row');
  topRight.appendChild(createNode('span', 'small muted', PK.formatScheduleLabel(promise.schedule)));
  const duePill = createNode('span', 'pill', PK.formatDueLabel(instance.dueAt, now));
  if (instance.dueAt - now <= PK.HOUR_MS) {
    duePill.classList.add('pill-broken');
  }
  topRight.appendChild(duePill);
  topRow.appendChild(topRight);
  card.appendChild(topRow);

  card.appendChild(createNode('h1', 'promise-text', promise.text));
  if (promise.why) {
    card.appendChild(createNode('p', 'muted', promise.why));
  }

  const footer = createNode('div', 'card-footer');
  if (promise.schedule === 'once') {
    footer.appendChild(createNode('span', 'small muted', 'Due ' + PK.formatShortDate(instance.dueAt) + ' at ' + PK.formatClockTime(instance.dueAt)));
  } else {
    footer.appendChild(buildWeekRow(promise, now));
  }
  footer.appendChild(buildCheckInButtons(instance.id, 'I kept it', 'I broke it', false));
  card.appendChild(footer);

  const retireButton = createButton('Retire this promise', 'link-button quiet', function () {
    openRetireDialog(promise.id);
  });
  retireButton.style.alignSelf = 'flex-start';
  card.appendChild(retireButton);
  return card;
}

function buildRestingCard(hasActivePromises) {
  const card = createNode('section', 'card card-centered');
  if (hasActivePromises) {
    card.appendChild(createNode('h1', 'promise-text', 'Nothing is due right now.'));
    card.appendChild(createNode('p', 'muted', 'You have answered for everything so far. Your repeating promises return on their next day.'));
  } else {
    card.appendChild(createNode('h1', 'promise-text', 'What will you promise yourself?'));
    card.appendChild(createNode('p', 'muted', 'Start with one promise you can keep. You can hold up to three at a time.'));
    card.appendChild(createButton('Make a promise', 'button button-primary', openPromiseDialog));
  }
  return card;
}

function findNextPendingInstance(promiseId) {
  for (const instance of PK.getPendingInstances(appState)) {
    if (instance.promiseId === promiseId) {
      return instance;
    }
  }
  return null;
}

function buildSmallPromiseCard(promise, now) {
  const card = createNode('div', 'small-card');
  const pendingInstance = findNextPendingInstance(promise.id);

  const topRow = createNode('div', 'card-row');
  topRow.appendChild(createNode('span', 'small muted', PK.formatScheduleLabel(promise.schedule)));
  if (pendingInstance && pendingInstance.dueAt < now) {
    topRow.appendChild(createNode('span', 'pill pill-broken', 'Waiting for your answer'));
  } else if (pendingInstance) {
    topRow.appendChild(createNode('span', 'pill pill-kept', PK.formatDueLabel(pendingInstance.dueAt, now)));
  } else {
    topRow.appendChild(createNode('span', 'pill pill-kept', 'Answered for now'));
  }
  card.appendChild(topRow);

  card.appendChild(createNode('p', 'promise-text-medium', promise.text));

  if (pendingInstance) {
    card.appendChild(buildCheckInButtons(pendingInstance.id, 'I kept it', 'I broke it', true));
  }

  const retireButton = createButton('Retire this promise', 'link-button quiet', function () {
    openRetireDialog(promise.id);
  });
  retireButton.style.alignSelf = 'flex-start';
  card.appendChild(retireButton);
  return card;
}

function buildSlotCard(openSlotCount) {
  const card = createNode('div', 'slot-card');
  let slotText = openSlotCount + ' of three slots are open.';
  if (openSlotCount === 1) {
    slotText = 'One of three slots is open.';
  }
  card.appendChild(createNode('span', 'small muted', slotText));
  card.appendChild(createButton('Make a promise', 'button button-outline-accent button-compact', openPromiseDialog));
  return card;
}

function buildStatCard(label, value) {
  const card = createNode('div', 'stat-card');
  card.appendChild(createNode('p', 'stat-label', label));
  card.appendChild(createNode('p', 'stat-value', value));
  return card;
}

function buildStatsRow() {
  const stats = PK.getStats(appState);
  const row = createNode('section', 'card-grid');
  let rateText = 'No results yet';
  if (stats.keptRate !== null) {
    rateText = stats.keptRate + '%';
  }
  row.appendChild(buildStatCard('Kept rate', rateText));
  row.appendChild(buildStatCard('Promises kept', String(stats.keptCount)));
  row.appendChild(buildStatCard('Kept in a row', String(stats.streak)));
  return row;
}

function renderToday() {
  const now = Date.now();
  todayView.replaceChildren();

  const activePromises = PK.getActivePromises(appState);
  const overdueInstances = PK.getOverdueInstances(appState, now);
  const upcomingInstances = PK.getUpcomingInstances(appState, now);

  let focusPromiseId = '';
  if (overdueInstances.length > 0) {
    const overdueInstance = overdueInstances[0];
    const overduePromise = PK.findPromise(appState, overdueInstance.promiseId);
    focusPromiseId = overduePromise.id;
    todayView.appendChild(buildOverdueCard(overdueInstance, overduePromise));
  } else if (upcomingInstances.length > 0) {
    const focusInstance = upcomingInstances[0];
    const focusPromise = PK.findPromise(appState, focusInstance.promiseId);
    focusPromiseId = focusPromise.id;
    todayView.appendChild(buildFocusCard(focusInstance, focusPromise, now));
  } else {
    todayView.appendChild(buildRestingCard(activePromises.length > 0));
  }

  const otherPromises = activePromises.filter(function (promise) {
    return promise.id !== focusPromiseId;
  });
  const openSlotCount = PK.MAX_ACTIVE_PROMISES - activePromises.length;
  const showSlotCard = openSlotCount > 0 && activePromises.length > 0;

  if (otherPromises.length > 0 || showSlotCard) {
    const grid = createNode('section', 'card-grid');
    for (const promise of otherPromises) {
      grid.appendChild(buildSmallPromiseCard(promise, now));
    }
    if (showSlotCard) {
      grid.appendChild(buildSlotCard(openSlotCount));
    }
    todayView.appendChild(grid);
  }

  todayView.appendChild(buildStatsRow());
}

// ---------- Rendering: history ----------

function buildWeeklyBars(now) {
  const block = createNode('div', 'bars-block');
  block.appendChild(createNode('p', 'stat-label', 'Kept rate, last six weeks'));

  const todayStart = PK.startOfDay(now);
  const daysSinceMonday = (new Date(todayStart).getDay() + 6) % 7;
  const thisMonday = PK.addDays(todayStart, -daysSinceMonday);
  const resolvedInstances = PK.getResolvedInstances(appState);

  const bars = createNode('div', 'bars');
  const labels = createNode('div', 'bar-labels');

  for (let weeksAgo = HISTORY_WEEK_COUNT - 1; weeksAgo >= 0; weeksAgo = weeksAgo - 1) {
    const weekStart = PK.addDays(thisMonday, -7 * weeksAgo);
    const weekEnd = PK.addDays(weekStart, 7);
    let keptCount = 0;
    let totalCount = 0;
    for (const instance of resolvedInstances) {
      if (instance.dueAt >= weekStart && instance.dueAt < weekEnd) {
        totalCount = totalCount + 1;
        if (instance.outcome === 'kept') {
          keptCount = keptCount + 1;
        }
      }
    }

    const bar = createNode('div', 'bar');
    let labelText = 'None';
    if (totalCount === 0) {
      bar.classList.add('is-empty');
      bar.style.height = '12%';
    } else {
      const weekRate = Math.round((keptCount / totalCount) * 100);
      bar.style.height = Math.max(weekRate, 4) + '%';
      labelText = weekRate + '%';
    }
    if (weeksAgo === 0) {
      bar.classList.add('is-current');
      labelText = labelText + ' this week';
    }
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', 'Week of ' + PK.formatShortDate(weekStart) + ': ' + labelText);
    bars.appendChild(bar);
    labels.appendChild(createNode('span', '', labelText));
  }

  block.appendChild(bars);
  block.appendChild(labels);
  return block;
}

function buildHistoryEntries() {
  const entries = [];
  for (const instance of PK.getResolvedInstances(appState)) {
    const promise = PK.findPromise(appState, instance.promiseId);
    let promiseText = 'A promise that is no longer stored';
    if (promise) {
      promiseText = promise.text;
    }
    entries.push({
      time: instance.dueAt,
      outcome: instance.outcome,
      text: promiseText,
      note: instance.note
    });
  }
  for (const promise of appState.promises) {
    if (promise.status === 'retired') {
      entries.push({
        time: promise.retiredAt,
        outcome: 'retired',
        text: promise.text,
        note: ''
      });
    }
  }
  entries.sort(function (first, second) {
    return second.time - first.time;
  });
  return entries;
}

function buildHistoryItem(entry) {
  const item = createNode('article', 'history-item');
  item.appendChild(createDot(entry.outcome));

  const body = createNode('div', 'history-body');
  body.appendChild(createNode('p', 'history-promise', entry.text));
  if (entry.note) {
    body.appendChild(createNode('p', 'small muted', 'What got in the way: ' + entry.note));
  }
  item.appendChild(body);

  const meta = createNode('div', 'history-meta');
  let outcomeLabel = 'Retired';
  if (entry.outcome === 'kept') {
    outcomeLabel = 'Kept';
  } else if (entry.outcome === 'broken') {
    outcomeLabel = 'Broken';
  }
  meta.appendChild(createNode('p', 'outcome-' + entry.outcome, outcomeLabel));
  meta.appendChild(createNode('p', '', PK.formatShortDate(entry.time)));
  item.appendChild(meta);
  return item;
}

function renderHistory() {
  const now = Date.now();
  const stats = PK.getStats(appState);
  historyView.replaceChildren();

  const headingRow = createNode('div', 'card-row');
  headingRow.appendChild(createNode('h1', 'history-heading', 'Your record'));
  headingRow.appendChild(createNode('p', 'small muted', stats.keptCount + ' kept and ' + stats.brokenCount + ' broken since you started'));
  historyView.appendChild(headingRow);

  const rateCard = createNode('section', 'card rate-card');
  const rateBlock = createNode('div', '');
  rateBlock.appendChild(createNode('p', 'stat-label', 'Kept rate'));
  let rateText = 'No results yet';
  if (stats.keptRate !== null) {
    rateText = stats.keptRate + '%';
  }
  rateBlock.appendChild(createNode('p', 'rate-value', rateText));
  rateCard.appendChild(rateBlock);
  rateCard.appendChild(buildWeeklyBars(now));
  historyView.appendChild(rateCard);

  const entries = buildHistoryEntries();
  const listCard = createNode('section', 'card history-list');
  if (entries.length === 0) {
    const emptyItem = createNode('article', 'history-item');
    emptyItem.appendChild(createNode('p', 'muted', 'Your kept and broken promises will be listed here once you check in.'));
    listCard.appendChild(emptyItem);
  } else {
    for (const entry of entries) {
      listCard.appendChild(buildHistoryItem(entry));
    }
  }
  historyView.appendChild(listCard);
}

// ---------- Rendering: shell ----------

function getThemeLabel(theme) {
  if (theme === 'light') {
    return 'Theme: Light';
  }
  if (theme === 'dark') {
    return 'Theme: Dark';
  }
  return 'Theme: Auto';
}

function render() {
  if (!appState) {
    return;
  }
  document.getElementById('today-date').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('theme-toggle').textContent = getThemeLabel(appState.settings.theme);

  const todayButton = document.getElementById('nav-today');
  const historyButton = document.getElementById('nav-history');
  if (currentView === 'today') {
    todayButton.classList.add('is-current');
    historyButton.classList.remove('is-current');
    todayView.classList.remove('hidden');
    historyView.classList.add('hidden');
    renderToday();
  } else {
    historyButton.classList.add('is-current');
    todayButton.classList.remove('is-current');
    historyView.classList.remove('hidden');
    todayView.classList.add('hidden');
    renderHistory();
  }
}

// ---------- Wiring ----------

document.getElementById('nav-today').addEventListener('click', function () {
  showView('today');
});
document.getElementById('nav-history').addEventListener('click', function () {
  showView('history');
});
document.getElementById('theme-toggle').addEventListener('click', cycleTheme);

document.getElementById('promise-form').addEventListener('submit', submitPromiseForm);
document.getElementById('promise-cancel').addEventListener('click', function () {
  promiseDialog.close();
});
for (const scheduleInput of document.querySelectorAll('input[name="schedule"]')) {
  scheduleInput.addEventListener('change', updateDueDateVisibility);
}

document.getElementById('note-form').addEventListener('submit', submitNoteForm);
document.getElementById('note-cancel').addEventListener('click', function () {
  noteDialog.close();
});
document.getElementById('note-text').addEventListener('input', function () {
  document.getElementById('note-error').textContent = '';
});

document.getElementById('retire-form').addEventListener('submit', submitRetireForm);
document.getElementById('retire-cancel').addEventListener('click', function () {
  retireDialog.close();
});

chrome.storage.onChanged.addListener(function () {
  refresh();
});

setInterval(function () {
  const dialogIsOpen = promiseDialog.open || noteDialog.open || retireDialog.open;
  if (!dialogIsOpen) {
    refresh();
  }
}, REFRESH_INTERVAL_MS);

refresh();
