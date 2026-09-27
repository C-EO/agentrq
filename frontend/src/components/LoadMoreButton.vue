<!--
  Copyright 2026 Contextual, Inc. https://agentrq.com
  This notice may not be modified or removed.
  SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- The one "load more" every task list uses, so they all look and behave alike. -->
<template>
  <button @click.stop="$emit('click')" :disabled="loading"
          class="bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-700 rounded-sm px-8 py-3 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-zinc-700 hover:text-gray-900 dark:hover:text-white transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2">
    <svg v-if="loading" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 12a8 8 0 018-8v8H4z" /></svg>
    {{ loading ? 'Loading...' : label }}
  </button>
</template>

<script setup>
defineProps({
  label: { type: String, default: 'Load More Entries' },
  loading: { type: Boolean, default: false }
});
defineEmits(['click']);
</script>
