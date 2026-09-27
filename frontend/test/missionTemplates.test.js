// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The suggested missions above a mission field, and the picker that writes
 * them: a pick pre-fills the text, and text the person wrote gets one undo.
 */

import { describe, it, expect } from 'vitest';
import { ref, nextTick } from 'vue';
import { MISSION_CATEGORIES, findMissionTemplate, isUntouchedMission } from '../src/utils/missionTemplates';
import { useMissionPicker } from '../src/composables/useMissionPicker';
import { DEFAULT_WORKSPACE_MISSION, WORKSPACE_WORKING_RULES } from '../src/utils/workspaceForm';

const category = (id) => MISSION_CATEGORIES.find((c) => c.id === id);
const sub = (catId, id) => category(catId).subcategories.find((s) => s.id === id);

describe('MISSION_CATEGORIES', () => {
  it('offers sales, coding, marketing and ops', () => {
    expect(MISSION_CATEGORIES.map((c) => c.label).sort()).toEqual(['Coding', 'Marketing', 'Ops', 'Sales']);
  });

  it('breaks coding and marketing into the specialities asked for', () => {
    expect(category('coding').subcategories.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Backend', 'Frontend', 'iOS', 'Android', 'Testing'])
    );
    expect(category('marketing').subcategories.map((s) => s.label)).toEqual(
      expect.arrayContaining(['Social Media', 'YouTube'])
    );
  });

  it('gives every speciality a distinct mission that names it and ends with the working rules', () => {
    const missions = MISSION_CATEGORIES.flatMap((c) => c.subcategories.map((s) => s.mission));
    expect(new Set(missions).size).toBe(missions.length);
    expect(sub('coding', 'ios').mission).toContain('iOS app development (Coding)');
    for (const m of missions) {
      expect(m.startsWith('This workspace is for ')).toBe(true);
      expect(m).toContain('**Focus**\n- ');
      expect(m.endsWith(WORKSPACE_WORKING_RULES)).toBe(true);
    }
  });

  it('keeps ids unique within each category', () => {
    for (const c of MISSION_CATEGORIES) {
      expect(new Set(c.subcategories.map((s) => s.id)).size).toBe(c.subcategories.length);
    }
  });
});

describe('isUntouchedMission', () => {
  it('holds for empty text, the default and an unedited template, surrounding space aside', () => {
    expect(isUntouchedMission('')).toBe(true);
    expect(isUntouchedMission(undefined)).toBe(true);
    expect(isUntouchedMission('  \n')).toBe(true);
    expect(isUntouchedMission(DEFAULT_WORKSPACE_MISSION)).toBe(true);
    expect(isUntouchedMission(`${sub('sales', 'crm').mission}\n`)).toBe(true);
  });

  it('fails for anything the person wrote', () => {
    expect(isUntouchedMission('Our billing service.')).toBe(false);
    expect(isUntouchedMission(`${sub('sales', 'crm').mission} Also HubSpot.`)).toBe(false);
  });
});

describe('findMissionTemplate', () => {
  it('names the category and speciality of an unedited template', () => {
    expect(findMissionTemplate(sub('marketing', 'youtube').mission)).toEqual({
      categoryId: 'marketing',
      subcategoryId: 'youtube',
    });
  });

  it('is null for other text', () => {
    expect(findMissionTemplate('mine')).toBeNull();
    expect(findMissionTemplate(null)).toBeNull();
  });
});

describe('useMissionPicker', () => {
  it('starts closed on the default mission, and toggles a category open and shut', () => {
    const picker = useMissionPicker(ref(DEFAULT_WORKSPACE_MISSION));
    expect(picker.categories).toBe(MISSION_CATEGORIES);
    expect(picker.activeCategory.value).toBeNull();
    expect(picker.selected.value).toBeNull();

    picker.toggleCategory('ops');
    expect(picker.activeCategory.value.label).toBe('Ops');
    picker.toggleCategory('sales');
    expect(picker.activeCategoryId.value).toBe('sales');
    picker.toggleCategory('sales');
    expect(picker.activeCategory.value).toBeNull();
  });

  it('opens on the category of a template the mission already is', () => {
    const picker = useMissionPicker(ref(sub('coding', 'android').mission));
    expect(picker.activeCategoryId.value).toBe('coding');
    expect(picker.selected.value).toEqual({ categoryId: 'coding', subcategoryId: 'android' });
  });

  it('opens on a template loaded after it started, but not over a category chosen by hand', async () => {
    const mission = ref('');
    const picker = useMissionPicker(mission);
    mission.value = 'still loading';
    await nextTick();
    expect(picker.activeCategoryId.value).toBeNull();

    mission.value = sub('ops', 'support').mission;
    await nextTick();
    expect(picker.activeCategoryId.value).toBe('ops');

    picker.toggleCategory('sales');
    mission.value = sub('coding', 'backend').mission;
    await nextTick();
    expect(picker.activeCategoryId.value).toBe('sales');
  });

  it('replaces an untouched mission with no undo', async () => {
    const mission = ref(DEFAULT_WORKSPACE_MISSION);
    const picker = useMissionPicker(mission);
    picker.pick(sub('coding', 'backend'));
    await nextTick();
    expect(mission.value).toBe(sub('coding', 'backend').mission);
    expect(picker.undoText.value).toBeNull();

    picker.pick(sub('coding', 'testing'));
    await nextTick();
    expect(mission.value).toBe(sub('coding', 'testing').mission);
    expect(picker.undoText.value).toBeNull();
  });

  it('does nothing when the speciality picked is already the mission', async () => {
    const mission = ref('Mine.');
    const picker = useMissionPicker(mission);
    picker.pick(sub('sales', 'outreach'));
    await nextTick();
    picker.pick(sub('sales', 'outreach'));
    await nextTick();
    expect(picker.undoText.value).toBe('Mine.');
  });

  it('keeps written text for one undo, which puts it back', async () => {
    const mission = ref('Our billing service.');
    const picker = useMissionPicker(mission);
    picker.pick(sub('ops', 'devops'));
    await nextTick();
    expect(picker.undoText.value).toBe('Our billing service.');

    picker.undo();
    await nextTick();
    expect(mission.value).toBe('Our billing service.');
    expect(picker.undoText.value).toBeNull();

    picker.undo();
    expect(mission.value).toBe('Our billing service.');
  });

  it('drops the undo once the person edits the picked text', async () => {
    const mission = ref('Our billing service.');
    const picker = useMissionPicker(mission);
    picker.pick(sub('ops', 'admin'));
    await nextTick();
    mission.value += ' Plus payroll.';
    await nextTick();
    expect(picker.undoText.value).toBeNull();
  });
});
