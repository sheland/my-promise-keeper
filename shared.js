'use strict';

// Shared data model and helpers for My Promise Keeper.
// Loaded by the new tab page, the toolbar popup, and the background worker.
//
// Data lives in chrome.storage.local in three keys:
//   promises:  what you promised (wording, schedule, deadline time)
//   instances: one entry per due date, with its outcome (pending, kept, broken)
//   settings:  theme choice and reminder snooze

const PK = {};

PK.MAX_ACTIVE_PROMISES = 3;
PK.FINAL_WARNING_MINUTES = 30;
PK.BACKFILL_DAYS = 14;
PK.MINUTE_MS = 60 * 1000;
PK.HOUR_MS = 60 * PK.MINUTE_MS;
PK.DAY_MS = 24 * PK.HOUR_MS;

// ---------- Storage ----------

PK.loadState = async function () {
  const stored = await chrome.storage.local.get(['promises', 'instances', 'settings']);
  const settings = stored.settings || {};
  return {
    promises: stored.promises || [],
    instances: stored.instances || [],
    settings: {
      theme: settings.theme || 'auto',
      snoozeUntil: settings.snoozeUntil || 0
    }
  };
};

PK.saveState = async function (state) {
  await chrome.storage.local.set({
    promises: state.promises,
    instances: state.instances,
    settings: state.settings
  });
};

// ---------- Date helpers ----------

PK.makeId = function () {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return Date.now().toString(36) + randomPart;
};

PK.padTwoDigits = function (number) {
  if (number < 10) {
    return '0' + number;
  }
  return String(number);
};

PK.toDateKey = function (date) {
  const year = date.getFullYear();
  const month = PK.padTwoDigits(date.getMonth() + 1);
  const day = PK.padTwoDigits(date.getDate());
  return year + '-' + month + '-' + day;
};

PK.dateFromKey = function (dateKey) {
  const parts = dateKey.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return new Date(year, month - 1, day);
};

PK.buildTimestamp = function (dateKey, timeText) {
  const date = PK.dateFromKey(dateKey);
  const timeParts = timeText.split(':');
  const hours = Number(timeParts[0]);
  const minutes = Number(timeParts[1]);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
};

PK.startOfDay = function (timestamp) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

PK.addDays = function (timestamp, dayCount) {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + dayCount);
  return date.getTime();
};

PK.isApplicableDay = function (schedule, date) {
  if (schedule === 'daily') {
    return true;
  }
  if (schedule === 'weekdays') {
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }
  return false;
};

// ---------- Lookups ----------

PK.findPromise = function (state, promiseId) {
  for (const promise of state.promises) {
    if (promise.id === promiseId) {
      return promise;
    }
  }
  return null;
};

PK.findInstance = function (state, instanceId) {
  for (const instance of state.instances) {
    if (instance.id === instanceId) {
      return instance;
    }
  }
  return null;
};

PK.getActivePromises = function (state) {
  return state.promises.filter(function (promise) {
    return promise.status === 'active';
  });
};

PK.getPendingInstances = function (state) {
  const pendingInstances = state.instances.filter(function (instance) {
    return instance.outcome === 'pending';
  });
  pendingInstances.sort(function (first, second) {
    return first.dueAt - second.dueAt;
  });
  return pendingInstances;
};

PK.getOverdueInstances = function (state, now) {
  return PK.getPendingInstances(state).filter(function (instance) {
    return instance.dueAt < now;
  });
};

PK.getUpcomingInstances = function (state, now) {
  return PK.getPendingInstances(state).filter(function (instance) {
    return instance.dueAt >= now;
  });
};

// ---------- Creating instances for repeating promises ----------

PK.addInstance = function (state, promise, dateKey) {
  state.instances.push({
    id: PK.makeId(),
    promiseId: promise.id,
    dateKey: dateKey,
    dueAt: PK.buildTimestamp(dateKey, promise.deadlineTime),
    outcome: 'pending',
    note: '',
    resolvedAt: 0,
    remindedAt: 0,
    warnedAt: 0
  });
};

// Makes sure every repeating promise has an instance for each day it applied,
// including days the browser was closed, so no deadline passes silently.
// Returns true when the state changed and needs saving.
PK.syncInstances = function (state, now) {
  let changed = false;
  const todayStart = PK.startOfDay(now);
  const todayKey = PK.toDateKey(new Date(todayStart));
  const earliestBackfillDay = PK.addDays(todayStart, -(PK.BACKFILL_DAYS - 1));

  for (const promise of state.promises) {
    if (promise.status !== 'active' || promise.schedule === 'once') {
      continue;
    }

    let cursorDay = PK.startOfDay(promise.createdAt);
    const createdDateKey = PK.toDateKey(new Date(cursorDay));
    const firstDeadline = PK.buildTimestamp(createdDateKey, promise.deadlineTime);
    if (promise.createdAt >= firstDeadline) {
      cursorDay = PK.addDays(cursorDay, 1);
    }

    if (promise.lastGeneratedDate) {
      const lastGeneratedDay = PK.dateFromKey(promise.lastGeneratedDate).getTime();
      const dayAfterLastGenerated = PK.addDays(lastGeneratedDay, 1);
      if (dayAfterLastGenerated > cursorDay) {
        cursorDay = dayAfterLastGenerated;
      }
    }

    if (earliestBackfillDay > cursorDay) {
      cursorDay = earliestBackfillDay;
    }

    while (cursorDay <= todayStart) {
      const cursorDate = new Date(cursorDay);
      if (PK.isApplicableDay(promise.schedule, cursorDate)) {
        PK.addInstance(state, promise, PK.toDateKey(cursorDate));
        changed = true;
      }
      cursorDay = PK.addDays(cursorDay, 1);
    }

    if (promise.lastGeneratedDate !== todayKey) {
      promise.lastGeneratedDate = todayKey;
      changed = true;
    }
  }

  return changed;
};

// ---------- Actions ----------

// fields: { text, why, schedule, dueDateKey, deadlineTime, reminderTime }
PK.createPromise = function (state, fields, now) {
  const promise = {
    id: PK.makeId(),
    text: fields.text,
    why: fields.why,
    schedule: fields.schedule,
    dueDateKey: fields.dueDateKey || '',
    deadlineTime: fields.deadlineTime,
    reminderTime: fields.reminderTime || '',
    createdAt: now,
    status: 'active',
    lastGeneratedDate: '',
    retiredAt: 0
  };
  state.promises.push(promise);

  if (promise.schedule === 'once') {
    PK.addInstance(state, promise, promise.dueDateKey);
  } else {
    PK.syncInstances(state, now);
  }
  return promise;
};

PK.resolveInstance = function (state, instanceId, outcome, note, now) {
  const instance = PK.findInstance(state, instanceId);
  if (!instance) {
    return;
  }
  instance.outcome = outcome;
  instance.note = note;
  instance.resolvedAt = now;

  const promise = PK.findPromise(state, instance.promiseId);
  if (promise && promise.schedule === 'once') {
    promise.status = 'done';
  }
};

// Retiring ends a promise. Instances that are not due yet are dropped.
// Instances whose deadline already passed stay, so they still get an answer.
PK.retirePromise = function (state, promiseId, now) {
  const promise = PK.findPromise(state, promiseId);
  if (!promise) {
    return;
  }
  promise.status = 'retired';
  promise.retiredAt = now;
  state.instances = state.instances.filter(function (instance) {
    const isNotYetDue = instance.outcome === 'pending' && instance.dueAt >= now;
    const belongsToPromise = instance.promiseId === promiseId;
    return !(belongsToPromise && isNotYetDue);
  });
};

// ---------- Stats ----------

PK.getResolvedInstances = function (state) {
  const resolvedInstances = state.instances.filter(function (instance) {
    return instance.outcome === 'kept' || instance.outcome === 'broken';
  });
  resolvedInstances.sort(function (first, second) {
    return first.dueAt - second.dueAt;
  });
  return resolvedInstances;
};

PK.getStats = function (state) {
  const resolvedInstances = PK.getResolvedInstances(state);
  let keptCount = 0;
  let brokenCount = 0;
  for (const instance of resolvedInstances) {
    if (instance.outcome === 'kept') {
      keptCount = keptCount + 1;
    } else {
      brokenCount = brokenCount + 1;
    }
  }

  let streak = 0;
  for (let index = resolvedInstances.length - 1; index >= 0; index = index - 1) {
    if (resolvedInstances[index].outcome !== 'kept') {
      break;
    }
    streak = streak + 1;
  }

  const totalCount = keptCount + brokenCount;
  let keptRate = null;
  if (totalCount > 0) {
    keptRate = Math.round((keptCount / totalCount) * 100);
  }

  return {
    keptCount: keptCount,
    brokenCount: brokenCount,
    keptRate: keptRate,
    streak: streak
  };
};

// One entry per day of the current week for a repeating promise.
PK.getWeekRow = function (state, promise, now) {
  const todayStart = PK.startOfDay(now);
  const todayKey = PK.toDateKey(new Date(todayStart));
  const daysSinceMonday = (new Date(todayStart).getDay() + 6) % 7;
  const mondayStart = PK.addDays(todayStart, -daysSinceMonday);
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let dayCount = 7;
  if (promise.schedule === 'weekdays') {
    dayCount = 5;
  }

  const weekRow = [];
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex = dayIndex + 1) {
    const dateKey = PK.toDateKey(new Date(PK.addDays(mondayStart, dayIndex)));
    let status = 'empty';
    for (const instance of state.instances) {
      if (instance.promiseId === promise.id && instance.dateKey === dateKey) {
        status = instance.outcome;
      }
    }
    weekRow.push({
      label: dayLabels[dayIndex],
      status: status,
      isToday: dateKey === todayKey
    });
  }
  return weekRow;
};

// ---------- Formatting ----------

PK.formatTimeLeft = function (milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / PK.MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return days + 'd ' + hours + 'h';
  }
  if (hours > 0) {
    return hours + 'h ' + minutes + 'm';
  }
  return minutes + 'm';
};

PK.formatBadgeText = function (milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / PK.MINUTE_MS));
  if (totalMinutes >= 24 * 60) {
    return Math.floor(totalMinutes / (24 * 60)) + 'd';
  }
  if (totalMinutes >= 60) {
    return Math.floor(totalMinutes / 60) + 'h';
  }
  return totalMinutes + 'm';
};

PK.formatClockTime = function (timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

PK.formatShortDate = function (timestamp) {
  return new Date(timestamp).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};

PK.formatDueLabel = function (dueAt, now) {
  const dueDay = PK.startOfDay(dueAt);
  const todayStart = PK.startOfDay(now);
  if (dueDay === todayStart) {
    return 'Due in ' + PK.formatTimeLeft(dueAt - now);
  }
  if (dueDay === PK.addDays(todayStart, 1)) {
    return 'Due tomorrow at ' + PK.formatClockTime(dueAt);
  }
  return 'Due ' + PK.formatShortDate(dueAt);
};

PK.formatScheduleLabel = function (schedule) {
  if (schedule === 'weekdays') {
    return 'Every weekday';
  }
  if (schedule === 'daily') {
    return 'Every day';
  }
  return 'One time';
};

PK.applyTheme = function (theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

if (typeof module !== 'undefined') {
  module.exports = PK;
}
