<!--
  Copyright 2026 Contextual, Inc. https://agentrq.com
  This notice may not be modified or removed.
  SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- A workspace's memories, read the way an agent reads them: MEMORY.md, and
     the memories it links to opened in its place. Read only: agents write
     these through the memory tools, and a human quietly rewriting one under an
     agent that has already read it is confusing from both sides. -->
<template>
  <div class="space-y-6 min-w-0 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <div class="space-y-1">
      <h3 class="text-[10px] font-bold text-gray-400 dark:text-zinc-500 uppercase tracking-widest ml-1">Workspace Memory</h3>
      <p class="text-[11px] text-gray-500 dark:text-zinc-400 font-medium ml-1">
        What agents working here have written down for the next one. They read
        <code class="bg-gray-100 dark:bg-zinc-800 px-1 py-0.5 rounded text-gray-900 dark:text-white">{{ memoryTitle(INDEX_MEMORY) }}</code>
        first, which indexes the rest. Every agent in this workspace shares them.
      </p>
    </div>

    <p v-if="state === MemoriesState.Loading" class="text-[11px] text-gray-400 dark:text-zinc-500 ml-1">Loading memories…</p>

    <!-- Boxed only from sm up: on a phone the settings card is the box. -->
    <div v-else-if="state === MemoriesState.Failed" data-test="memories-failed"
         class="sm:p-4 sm:bg-red-50 sm:dark:bg-red-500/10 sm:border sm:border-red-100 sm:dark:border-red-500/20 sm:rounded-sm">
      <p class="text-[11px] font-bold text-red-600 dark:text-red-400">Could not load this workspace's memories.</p>
      <button type="button" @click="load" class="mt-2 text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-400 hover:underline">Try again</button>
    </div>

    <div v-else-if="state === MemoriesState.Empty" data-test="memories-empty"
         class="sm:p-6 sm:bg-gray-50 sm:dark:bg-zinc-800/50 sm:rounded-sm sm:border sm:border-gray-100 sm:dark:border-zinc-800 sm:text-center">
      <p class="text-[11px] font-bold text-gray-700 dark:text-zinc-200">Nothing remembered yet.</p>
      <p class="mt-1 text-[11px] text-gray-500 dark:text-zinc-400">
        This is how every workspace starts. Agents write here themselves when they learn
        something worth keeping — there is nothing to set up.
      </p>
    </div>

    <template v-else>
      <section v-if="current.name" class="ml-1 space-y-3 min-w-0">
        <!-- Which memory is open, and the way back. Icons alone on a phone. -->
        <div class="flex items-center justify-between gap-2 min-w-0">
          <div class="flex items-center gap-2 min-w-0">
            <button v-if="history.length" type="button" data-test="memory-back" @click="back" title="Back" aria-label="Back"
                    class="shrink-0 p-1 -m-1 sm:p-0 sm:m-0 text-[9px] font-black uppercase tracking-widest text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-100">
              <svg class="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg><span class="hidden sm:inline">← Back</span>
            </button>
            <h4 data-test="memory-name" class="min-w-0 truncate text-xs font-bold text-gray-800 dark:text-zinc-100 font-mono">{{ memoryTitle(current.name) }}</h4>
          </div>
          <button type="button" data-test="memory-raw" @click="showRaw = !showRaw" title="Raw" aria-label="Raw" :aria-pressed="showRaw"
                  :class="showRaw ? 'text-gray-700 dark:text-zinc-200' : 'text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300'"
                  class="shrink-0 text-[8px] font-black uppercase tracking-wider transition-colors px-1 py-0.5 rounded">
            <svg class="w-4 h-4 sm:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg><span class="hidden sm:inline">Raw</span>
          </button>
        </div>

        <p v-if="current.loading" class="text-[11px] text-gray-400 dark:text-zinc-500">Loading…</p>
        <p v-else-if="current.missing" data-test="memory-missing" class="text-[11px] font-bold text-amber-600 dark:text-amber-400 break-words">{{ current.missing }}</p>
        <p v-else-if="current.error" data-test="memory-error" class="text-[11px] font-bold text-red-600 dark:text-red-400">{{ current.error }}</p>
        <div v-else-if="showRaw" data-test="memory-raw-body" class="text-[12px] text-gray-800 dark:text-zinc-200 whitespace-pre-wrap break-words font-mono">{{ current.content }}</div>
        <div v-else data-test="memory-body" class="md-body text-[13px] text-gray-800 dark:text-zinc-200"
             @click="follow" @keydown.enter="follow"
             v-html="renderMarkdown(current.content)"></div>
      </section>

      <p v-else data-test="memory-no-index" class="text-[11px] font-bold text-gray-700 dark:text-zinc-200 ml-1">
        {{ memoryTitle(INDEX_MEMORY) }} is not written yet, so nothing indexes these.
      </p>

      <!-- The memories the index leaves out, or all of them without one, so
           none is out of a person's reach. -->
      <nav v-if="listed.length" data-test="memory-unlinked" aria-label="Other memories"
           :class="current.name ? 'pt-4 border-t border-gray-100 dark:border-zinc-800' : ''" class="ml-1 min-w-0">
        <p v-if="current.name" class="mb-1.5 text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-zinc-500">Not linked from {{ memoryTitle(INDEX_MEMORY) }}</p>
        <ul class="flex flex-wrap gap-x-4 gap-y-1">
          <li v-for="name in listed" :key="name" class="min-w-0 max-w-full">
            <button type="button" data-test="memory-unlinked-item" @click="open(name)" :title="name"
                    class="max-w-full truncate text-[11px] font-mono text-gray-600 dark:text-zinc-300 underline decoration-dotted underline-offset-2 hover:text-gray-900 dark:hover:text-zinc-100">{{ name }}</button>
          </li>
        </ul>
      </nav>
    </template>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';

import { fetchWorkspaceMemories, getWorkspaceMemory } from '../api';
import { INDEX_MEMORY, MemoriesState, memoryTitle, useMemoryReader } from '../composables/useMemories';
import { renderMarkdown } from '../utils/markdown';

const props = defineProps({
  workspaceId: { type: String, required: true },
});

const { state, current, history, listed, load, open, follow, back } = useMemoryReader(() => props.workspaceId, {
  fetchList: fetchWorkspaceMemories,
  fetchOne: getWorkspaceMemory,
});
const showRaw = ref(false);

// Fetched when the tab is opened rather than with the rest of settings: most
// visits are not about memories, and memories change while nobody looks.
onMounted(load);
watch(() => props.workspaceId, load);
</script>
