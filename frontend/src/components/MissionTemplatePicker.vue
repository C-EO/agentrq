<!--
  Copyright 2026 Contextual, Inc. https://agentrq.com
  This notice may not be modified or removed.
  SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- Optional category chips above a mission field: a category opens its
     specialities, and a speciality pre-fills the mission, which stays editable. -->
<template>
  <div class="space-y-2" data-mission-picker>
    <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Mission category">
      <span class="w-full sm:w-auto text-[11px] font-medium text-gray-500 dark:text-zinc-400 sm:mr-1">Start from</span>
      <button v-for="category in categories" :key="category.id" type="button"
              :aria-pressed="activeCategoryId === category.id"
              @click="toggleCategory(category.id)"
              :class="[CHIP, activeCategoryId === category.id ? CHIP_ON : CHIP_OFF]">
        {{ category.label }}
      </button>
      <button v-if="undoText !== null" type="button" @click="undo"
              class="ml-auto text-[11px] font-semibold text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100 underline-offset-2 hover:underline">
        Undo
      </button>
    </div>
    <div v-if="activeCategory" class="flex flex-wrap items-center gap-1.5 pl-3 border-l-2 border-gray-200 dark:border-zinc-700"
         role="group" :aria-label="`${activeCategory.label} speciality`">
      <button v-for="sub in activeCategory.subcategories" :key="sub.id" type="button"
              :aria-pressed="selected?.subcategoryId === sub.id && selected?.categoryId === activeCategory.id"
              @click="pick(sub)"
              :class="[CHIP, selected?.subcategoryId === sub.id && selected?.categoryId === activeCategory.id ? CHIP_ON : CHIP_OFF]">
        {{ sub.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { useMissionPicker } from '../composables/useMissionPicker';

const CHIP = 'px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors';
const CHIP_ON = 'bg-black dark:bg-white border-black dark:border-white text-white dark:text-zinc-900';
const CHIP_OFF =
  'bg-white dark:bg-zinc-900 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 ' +
  'hover:border-gray-400 dark:hover:border-zinc-500';

const mission = defineModel({ type: String, default: '' });
const { categories, activeCategoryId, activeCategory, selected, undoText, toggleCategory, pick, undo } =
  useMissionPicker(mission);
</script>
