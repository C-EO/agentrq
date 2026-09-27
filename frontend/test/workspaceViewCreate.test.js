// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The overview's create-workspace form, mounted: it opens with the default
 * mission and self-learning loop note filled in, sends what the person left
 * there, and opens with the defaults again after a cancel.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp, h } from 'vue';
import { createPinia } from 'pinia';

const push = vi.fn();
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ params: {}, query: {} }) }));

const createWorkspace = vi.fn();
const fetchWorkspaces = vi.fn();
vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal()),
  createWorkspace: (...args) => createWorkspace(...args),
  fetchWorkspaces: (...args) => fetchWorkspaces(...args),
  fetchGlobalTaskStats: async () => ({}),
  fetchGlobalTasks: async () => ({ tasks: [] }),
  fetchUserStats: async () => ({}),
}));

import WorkspaceView from '../src/views/WorkspaceView.vue';
import { DEFAULT_SELF_LEARNING_LOOP_NOTE, DEFAULT_WORKSPACE_MISSION } from '../src/utils/workspaceForm';

const settle = () => new Promise((r) => setTimeout(r, 30));

let app;
let el;

async function mount() {
  el = document.createElement('div');
  document.body.appendChild(el);
  app = createApp({ render: () => h(WorkspaceView) });
  app.use(createPinia());
  app.component('RouterLink', { props: ['to'], setup: (p, { slots }) => () => h('a', {}, slots.default?.()) });
  app.directive('click-outside', {});
  app.mount(el);
  await settle();
}

const missionField = () => el.querySelectorAll('form textarea')[0];
const noteField = () => el.querySelectorAll('form textarea')[1];

beforeEach(() => {
  app?.unmount();
  el?.remove();
  localStorage.clear();
  push.mockReset();
  createWorkspace.mockReset();
  createWorkspace.mockResolvedValue({ workspace: { id: 'w1' } });
  // No workspaces yet, so the form opens by itself.
  fetchWorkspaces.mockReset();
  fetchWorkspaces.mockResolvedValue({ workspaces: [] });
});

describe('creating a workspace', () => {
  it('opens with the default mission and self-learning loop note filled in', async () => {
    await mount();
    expect(missionField().value).toBe(DEFAULT_WORKSPACE_MISSION);
    expect(noteField().value).toBe(DEFAULT_SELF_LEARNING_LOOP_NOTE);
  });

  it('sends the mission and note as the person left them', async () => {
    await mount();
    const name = el.querySelector('form input');
    name.value = 'billing';
    name.dispatchEvent(new Event('input'));
    missionField().value = 'Invoices.';
    missionField().dispatchEvent(new Event('input'));
    noteField().value = 'Be concise.';
    noteField().dispatchEvent(new Event('input'));
    await settle();

    el.querySelector('form').dispatchEvent(new Event('submit'));
    await settle();

    expect(createWorkspace).toHaveBeenCalledOnce();
    expect(createWorkspace.mock.calls[0][1]).toBe('Invoices.');
    expect(createWorkspace.mock.calls[0][3]).toBe('Be concise.');
    expect(push).toHaveBeenCalledWith('/workspaces/w1');
  });

  it('brings the defaults back after an edited form is cancelled', async () => {
    await mount();
    missionField().value = 'scratch';
    missionField().dispatchEvent(new Event('input'));
    noteField().value = 'scratch';
    noteField().dispatchEvent(new Event('input'));
    await settle();

    [...el.querySelectorAll('form button')].find((b) => b.textContent.trim() === 'Cancel').click();
    await settle();
    // With no workspaces, the list is the empty state and its button.
    [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New Workspace').click();
    await settle();

    expect(missionField().value).toBe(DEFAULT_WORKSPACE_MISSION);
    expect(noteField().value).toBe(DEFAULT_SELF_LEARNING_LOOP_NOTE);
  });
});
