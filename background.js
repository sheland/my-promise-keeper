'use strict';

// Background worker: keeps the toolbar badge current and sends reminders.

importScripts('shared.js');

const TICK_ALARM_NAME = 'promise-keeper-tick';
const BADGE_COLOR_CALM = '#2F5D50';
const BADGE_COLOR_SOON = '#A8552F';

function startTicking() {
  chrome.alarms.create(TICK_ALARM_NAME, { periodInMinutes: 1 });
  runTick();
}

async function updateBadge(state, now) {
  const overdueInstances = PK.getOverdueInstances(state, now);
  const upcomingInstances = PK.getUpcomingInstances(state, now);

  if (overdueInstances.length > 0) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_SOON });
    await chrome.action.setBadgeText({ text: '?' });
    return;
  }

  if (upcomingInstances.length === 0) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const timeLeft = upcomingInstances[0].dueAt - now;
  let badgeColor = BADGE_COLOR_CALM;
  if (timeLeft <= PK.HOUR_MS) {
    badgeColor = BADGE_COLOR_SOON;
  }
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor });
  await chrome.action.setBadgeText({ text: PK.formatBadgeText(timeLeft) });
}

function showNotification(instanceId, kind, title, message) {
  chrome.notifications.create(kind + ':' + instanceId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message
  });
}

// Sends at most two notifications per deadline: one at the reminder time
// the person chose, and one final warning shortly before the deadline.
function sendDueReminders(state, now) {
  let changed = false;
  if (now < state.settings.snoozeUntil) {
    return changed;
  }

  const finalWarningWindow = PK.FINAL_WARNING_MINUTES * PK.MINUTE_MS;

  for (const instance of PK.getUpcomingInstances(state, now)) {
    const promise = PK.findPromise(state, instance.promiseId);
    if (!promise) {
      continue;
    }

    const warningAt = instance.dueAt - finalWarningWindow;
    if (now >= warningAt && !instance.warnedAt) {
      const timeLeftText = PK.formatTimeLeft(instance.dueAt - now);
      showNotification(instance.id, 'warning', timeLeftText + ' left on your promise', promise.text);
      instance.warnedAt = now;
      instance.remindedAt = instance.remindedAt || now;
      changed = true;
      continue;
    }

    if (!promise.reminderTime || instance.remindedAt) {
      continue;
    }
    const reminderAt = PK.buildTimestamp(instance.dateKey, promise.reminderTime);
    if (reminderAt < instance.dueAt && now >= reminderAt) {
      const dueText = 'Due at ' + PK.formatClockTime(instance.dueAt) + '. ' + promise.text;
      showNotification(instance.id, 'reminder', 'A promise is waiting for you', dueText);
      instance.remindedAt = now;
      changed = true;
    }
  }

  return changed;
}

async function runTick() {
  const now = Date.now();
  const state = await PK.loadState();
  const instancesChanged = PK.syncInstances(state, now);
  const remindersChanged = sendDueReminders(state, now);
  if (instancesChanged || remindersChanged) {
    await PK.saveState(state);
  }
  await updateBadge(state, now);
}

chrome.runtime.onInstalled.addListener(startTicking);
chrome.runtime.onStartup.addListener(startTicking);

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === TICK_ALARM_NAME) {
    runTick();
  }
});

chrome.storage.onChanged.addListener(async function () {
  const state = await PK.loadState();
  await updateBadge(state, Date.now());
});

chrome.notifications.onClicked.addListener(function (notificationId) {
  chrome.notifications.clear(notificationId);
  chrome.tabs.create({});
});
