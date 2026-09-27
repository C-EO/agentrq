<!--
  Copyright 2026 Contextual, Inc. https://agentrq.com
  This notice may not be modified or removed.
  SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="[toast.type, { clickable: hasLink(toast) }]"
        @click="openLink(toast)"
      >
        <span class="toast-icon" aria-hidden="true">
          <svg v-if="toast.type === 'success'" viewBox="0 0 16 16"><path d="M4.5 8.5l2.2 2.2L11.5 6" /></svg>
          <svg v-else-if="toast.type === 'error'" viewBox="0 0 16 16"><path d="M8 4.5v4.2M8 11.3v.2" /></svg>
          <svg v-else viewBox="0 0 16 16"><path d="M8 7.3v4.2M8 4.5v.2" /></svg>
        </span>
        <div class="toast-content">
          <div v-if="toast.title" class="toast-title">{{ toast.title }}</div>
          <!-- Two lines at most, four for an error; the whole message is on hover. -->
          <div class="toast-message" :class="{ solo: !toast.title }" :title="toast.message">{{ toast.message }}</div>
          <div v-if="hasLink(toast)" class="toast-link">View task</div>
        </div>
        <button @click.stop="removeToast(toast.id)" class="toast-close" aria-label="Dismiss">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
        <div
          v-if="!toast.persistent"
          class="toast-progress"
          :style="{ animationDuration: `${toast.duration}ms` }"
        ></div>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useToasts } from '../composables/useToasts';

const { toasts, removeToast } = useToasts();
const router = useRouter();

// Falsy ids mean the toast has nothing to link to — the same sentinel
// useStreamToasts.toastFor uses for "no task".
function hasLink(toast) {
  return Boolean(toast.link?.taskId && toast.link?.workspaceId);
}

function openLink(toast) {
  if (!hasLink(toast)) return;
  removeToast(toast.id);
  router.push(`/workspaces/${toast.link.workspaceId}/tasks/${toast.link.taskId}`);
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: 10px;
  pointer-events: none;
}

@media (max-width: 640px) {
  .toast-container {
    bottom: 12px;
    left: 12px;
    right: 12px;
    align-items: stretch;
  }
}

.toast {
  pointer-events: auto;
  position: relative;
  overflow: hidden;
  width: 380px;
  padding: 14px 14px 16px;
  background: #fafafa;
  color: #18181b;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  box-shadow: 0 8px 24px -6px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: flex-start;
  gap: 10px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@media (max-width: 640px) {
  .toast {
    width: 100%;
  }
}

.dark .toast {
  background: #27272a;
  color: #f4f4f5;
  border-color: #3f3f46;
  box-shadow: 0 8px 24px -6px rgba(0, 0, 0, 0.6);
}

.toast.clickable {
  cursor: pointer;
}

.toast.clickable:hover {
  border-color: #d4d4d8;
}

.dark .toast.clickable:hover {
  border-color: #71717a;
}

.toast-icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 9999px;
  display: grid;
  place-items: center;
  background: #27272a;
  color: #fafafa;
}

.toast-icon svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.dark .toast-icon {
  background: #e4e4e7;
  color: #27272a;
}

.toast.success .toast-icon { background: #16a34a; color: #fff; }
.toast.error .toast-icon { background: #dc2626; color: #fff; }
.dark .toast.success .toast-icon { background: #22c55e; color: #052e16; }
.dark .toast.error .toast-icon { background: #f87171; color: #450a0a; }

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toast-message {
  font-size: 13px;
  line-height: 19px;
  color: #52525b;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.dark .toast-message {
  color: #a1a1aa;
}

.toast.error .toast-message {
  -webkit-line-clamp: 4;
  line-clamp: 4;
}

/* Without a title the message is the headline. */
.toast-message.solo {
  font-size: 14px;
  line-height: 20px;
  color: inherit;
}

.toast-link {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #7c3aed;
}

.dark .toast-link {
  color: #a78bfa;
}

.toast.clickable:hover .toast-link {
  text-decoration: underline;
}

.toast-close {
  flex: none;
  background: none;
  border: none;
  color: #71717a;
  cursor: pointer;
  padding: 2px;
  margin: -2px -2px 0 0;
  border-radius: 4px;
  transition: color 0.15s, background-color 0.15s;
}

.toast-close svg {
  display: block;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.toast-close:hover {
  color: #18181b;
  background: #f4f4f5;
}

.dark .toast-close {
  color: #a1a1aa;
}

.dark .toast-close:hover {
  color: #fafafa;
  background: #3f3f46;
}

/* The auto-close countdown, as long as the toast's own duration. */
.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  width: 100%;
  background: #a1a1aa;
  opacity: 0.5;
  animation: progress linear forwards;
}

.dark .toast-progress {
  background: #a1a1aa;
}

@keyframes progress {
  from { width: 100%; }
  to { width: 0%; }
}

.toast-enter-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateY(12px);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(24px);
}

.toast-move {
  transition: transform 0.3s ease;
}
</style>
