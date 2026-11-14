'use strict';

// Toolbar popup: shows the next promise due and lets you check in quickly.

const SNOOZE_DURATION_MS = 60 * 60 * 1000;

let popupState = null;
let noteModeInstanceId = '';

const popupContent = document.getElementById('popup-content');

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

async function refreshPopup() {
  popupState = await PK.loadState();
  const changed = PK.syncInstances(popupState, Date.now());
  if (changed) {
    await PK.saveState(popupState);
  }
  PK.applyTheme(popupState.settings.theme);
  renderPopup();
}

async function markKept(instanceId) {
  PK.resolveInstance(popupState, instanceId, 'kept', '', Date.now());
  await PK.saveState(popupState);
  renderPopup();
}

async function saveBrokenNote(instanceId, noteInput, errorNode) {
  const note = noteInput.value.trim();
  if (!note) {
    errorNode.textContent = 'Add a short note first. One sentence is enough.';
    return;
  }
  PK.resolveInstance(popupState, instanceId, 'broken', note, Date.now());
  noteModeInstanceId = '';
  await PK.saveState(popupState);
  renderPopup();
}

function buildNoteForm(instance) {
  const form = createNode('div', 'popup-buttons');
  const label = createNode('label', 'field-label', 'What got in the way?');
  label.setAttribute('for', 'popup-note');
  const noteInput = createNode('textarea', '');
  noteInput.id = 'popup-note';
  noteInput.rows = 3;
  noteInput.maxLength = 400;
  const errorNode = createNode('p', 'error-text');
  errorNode.setAttribute('role', 'alert');
  noteInput.addEventListener('input', function () {
    errorNode.textContent = '';
  });

  form.appendChild(label);
  form.appendChild(noteInput);
  form.appendChild(errorNode);
  form.appendChild(createButton('Save note', 'button button-primary', function () {
    saveBrokenNote(instance.id, noteInput, errorNode);
  }));
  form.appendChild(createButton('Go back', 'button', function () {
    noteModeInstanceId = '';
    renderPopup();
  }));
  return form;
}

function buildFocusCard(instance, promise, now) {
  const card = createNode('div', 'popup-card');
  const isOverdue = instance.dueAt < now;

  const topRow = createNode('div', 'card-row');
  if (isOverdue) {
    topRow.appendChild(createNode('span', 'small muted', 'Did you keep it?'));
    topRow.appendChild(createNode('span', 'pill pill-broken', 'Deadline passed'));
  } else {
    topRow.appendChild(createNode('span', 'small muted', 'Next up'));
    const duePill = createNode('span', 'pill', PK.formatDueLabel(instance.dueAt, now));
    if (instance.dueAt - now <= PK.HOUR_MS) {
      duePill.classList.add('pill-broken');
    }
    topRow.appendChild(duePill);
  }
  card.appendChild(topRow);
  card.appendChild(createNode('p', 'promise-text-medium', promise.text));

  if (noteModeInstanceId === instance.id) {
    card.appendChild(buildNoteForm(instance));
    return card;
  }

  const buttons = createNode('div', 'popup-buttons');
  buttons.appendChild(createButton('I kept it', 'button button-primary', function () {
    markKept(instance.id);
  }));
  buttons.appendChild(createButton('I broke it', 'button', function () {
    noteModeInstanceId = instance.id;
    renderPopup();
  }));
  card.appendChild(buttons);
  return card;
}

function renderPopup() {
  const now = Date.now();
  const stats = PK.getStats(popupState);
  const rateNode = document.getElementById('popup-rate');
  if (stats.keptRate === null) {
    rateNode.textContent = '';
  } else {
    rateNode.textContent = stats.keptRate + '% kept';
  }

  const snoozeButton = document.getElementById('popup-snooze');
  if (now < popupState.settings.snoozeUntil) {
    snoozeButton.textContent = 'Snoozed until ' + PK.formatClockTime(popupState.settings.snoozeUntil);
  } else {
    snoozeButton.textContent = 'Snooze reminders 1 hour';
  }

  popupContent.replaceChildren();
  const pendingInstances = PK.getPendingInstances(popupState);

  if (pendingInstances.length === 0) {
    const emptyCard = createNode('div', 'popup-card');
    if (PK.getActivePromises(popupState).length > 0) {
      emptyCard.appendChild(createNode('p', 'promise-text-medium', 'Nothing is due right now.'));
    } else {
      emptyCard.appendChild(createNode('p', 'promise-text-medium', 'No promises yet.'));
      emptyCard.appendChild(createNode('p', 'small muted', 'Open the full page to make your first one.'));
    }
    popupContent.appendChild(emptyCard);
    return;
  }

  const focusInstance = pendingInstances[0];
  const focusPromise = PK.findPromise(popupState, focusInstance.promiseId);
  popupContent.appendChild(buildFocusCard(focusInstance, focusPromise, now));

  if (pendingInstances.length > 1) {
    const moreCount = pendingInstances.length - 1;
    let moreText = moreCount + ' more promises are waiting on the full page.';
    if (moreCount === 1) {
      moreText = 'One more promise is waiting on the full page.';
    }
    popupContent.appendChild(createNode('p', 'small muted', moreText));
  }
}

document.getElementById('popup-open-page').addEventListener('click', function () {
  chrome.tabs.create({});
});

document.getElementById('popup-snooze').addEventListener('click', async function () {
  popupState.settings.snoozeUntil = Date.now() + SNOOZE_DURATION_MS;
  await PK.saveState(popupState);
  renderPopup();
});

refreshPopup();
