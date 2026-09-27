// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

import { ref } from 'vue';

const toasts = ref([]);

// An error shows up to four lines and takes longer to read, so it stays longer.
const DURATION = 4000;
const ERROR_DURATION = 20000;

export function useToasts() {
  // `link`, when given, is `{ taskId, workspaceId }` — where clicking the
  // toast (not its close button) should navigate. Falsy ids mean no link.
  const addToast = (message, type = 'info', title = null, duration = null, link = null) => {
    if (duration === null) duration = type === 'error' ? ERROR_DURATION : DURATION;
    const id = Date.now() + Math.random();
    // A zero duration means the toast waits to be dismissed; the progress bar
    // is a countdown, so it has nothing to show.
    const toast = { id, message, type, title, duration, persistent: duration <= 0, link };

    toasts.value.push(toast);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
    return id;
  };

  const removeToast = (id) => {
    toasts.value = toasts.value.filter(t => t.id !== id);
  };

  // No default title: the icon already says error, success or info.
  const notifyError = (message, title = null, link = null) => addToast(message, 'error', title, null, link);
  const notifySuccess = (message, title = null, link = null) => addToast(message, 'success', title, null, link);
  const notifyInfo = (message, title = null, link = null) => addToast(message, 'info', title, null, link);

  return {
    toasts,
    addToast,
    removeToast,
    notifyError,
    notifySuccess,
    notifyInfo
  };
}
