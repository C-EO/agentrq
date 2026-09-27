// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

import { ref, computed, watch } from 'vue';
import { MISSION_CATEGORIES, findMissionTemplate, isUntouchedMission } from '../utils/missionTemplates';

/**
 * The state behind the category chips above a mission field. Picking a
 * speciality writes its template into the field; when that overwrites text the
 * person wrote, the old text is kept for one undo, since the app has no
 * confirmation dialog to ask first.
 *
 * @param {import('vue').Ref<string>} mission the mission text, read and written
 */
export function useMissionPicker(mission) {
  const activeCategoryId = ref(findMissionTemplate(mission.value)?.categoryId ?? null);
  const undoText = ref(null);
  let applied = null;

  const activeCategory = computed(() => MISSION_CATEGORIES.find((c) => c.id === activeCategoryId.value) ?? null);
  const selected = computed(() => findMissionTemplate(mission.value));

  watch(mission, (text) => {
    // A settings form loads its mission after mount: open the category of a
    // template it holds, unless the person already chose one.
    if (activeCategoryId.value === null) activeCategoryId.value = findMissionTemplate(text)?.categoryId ?? null;
    // Typing after a pick makes the new text theirs; the undo would lose it.
    if (text !== applied) undoText.value = null;
  });

  function toggleCategory(id) {
    activeCategoryId.value = activeCategoryId.value === id ? null : id;
  }

  function pick(sub) {
    if (mission.value === sub.mission) return;
    const previous = mission.value;
    applied = sub.mission;
    mission.value = sub.mission;
    undoText.value = isUntouchedMission(previous) ? null : previous;
  }

  function undo() {
    if (undoText.value === null) return;
    applied = undoText.value;
    mission.value = undoText.value;
    undoText.value = null;
  }

  return {
    categories: MISSION_CATEGORIES,
    activeCategoryId,
    activeCategory,
    selected,
    undoText,
    toggleCategory,
    pick,
    undo,
  };
}
