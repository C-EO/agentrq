// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { ref } from 'vue';

const toasts = ref([]);

export function useToasts() {
  // `link`, when given, is `{ taskId, workspaceId }` — where clicking the
  // toast (not its close button) should navigate. Falsy ids mean no link.
  const addToast = (message, type = 'info', title = null, duration = 4000, link = null) => {
    const id = Date.now() + Math.random();
    // A zero duration means the toast waits to be dismissed; the progress bar
    // is a countdown, so it has nothing to show.
    const toast = { id, message, type, title, persistent: duration <= 0, link };

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

  const notifyError = (message, title = 'Error', link = null) => addToast(message, 'error', title, 4000, link);
  const notifySuccess = (message, title = 'Success', link = null) => addToast(message, 'success', title, 4000, link);
  const notifyInfo = (message, title = 'Notice', link = null) => addToast(message, 'info', title, 4000, link);

  return {
    toasts,
    addToast,
    removeToast,
    notifyError,
    notifySuccess,
    notifyInfo
  };
}
