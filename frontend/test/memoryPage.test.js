// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Memories tab, mounted: memory.md rendered, its links opened in place
 * with Back, and the memories it does not link to listed under it. The logic
 * is `useMemoryReader` (`memories.test.js`); this checks the wiring, which the
 * coverage gate does not count.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApp, h } from 'vue';

let MEMORIES = [];
const CONTENT = {
  'memory.md': '# Index\n\n- [how we ship](memory://deploys.md)\n- [later](memory://later.md)',
  'deploys.md': 'Ship **carefully**. Back to [the index](memory://memory.md).',
  'orphan.md': 'Nobody links here.',
};

const api = vi.hoisted(() => ({
  fetchWorkspaceMemories: vi.fn(),
  getWorkspaceMemory: vi.fn(),
}));
vi.mock('../src/api', () => api);

const { default: WorkspaceMemoryPage } = await import('../src/components/WorkspaceMemoryPage.vue');

const settle = () => new Promise((r) => setTimeout(r, 30));
const apps = [];

async function mount(workspaceId = 'ws1') {
  const el = document.createElement('div');
  document.body.append(el);
  const app = createApp({ render: () => h(WorkspaceMemoryPage, { workspaceId }) });
  app.mount(el);
  apps.push(app);
  await settle();
  return el;
}

const q = (el, test) => el.querySelector(`[data-test="${test}"]`);
const text = (node) => node?.textContent.replace(/\s+/g, ' ').trim();
const click = async (node) => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await settle();
};
const unlinked = (el) => [...el.querySelectorAll('[data-test="memory-unlinked-item"]')].map((b) => b.textContent.trim());

beforeEach(() => {
  while (apps.length) apps.pop().unmount();
  document.body.innerHTML = '';
  MEMORIES = ['memory.md', 'deploys.md', 'orphan.md'].map((name) => ({ name }));
  api.fetchWorkspaceMemories.mockReset().mockImplementation(async () => ({ memories: MEMORIES }));
  api.getWorkspaceMemory.mockReset().mockImplementation(async (_ws, name) => ({ memory: { name, content: CONTENT[name] } }));
});

describe('the Memories tab', () => {
  it('shows memory.md alone, rendered, and lists what it does not link to', async () => {
    const el = await mount();

    expect(api.fetchWorkspaceMemories).toHaveBeenCalledWith('ws1');
    expect(text(q(el, 'memory-name'))).toBe('MEMORY.md');
    expect(q(el, 'memory-body').querySelector('h1').textContent).toBe('Index');
    expect(q(el, 'memory-back')).toBeNull();
    // deploys.md is reached from the index; only the orphan is listed.
    expect(unlinked(el)).toEqual(['orphan.md']);
    expect(text(q(el, 'memory-unlinked'))).toContain('Not linked from MEMORY.md');
  });

  it('follows a memory:// link in place, and Back returns to the index', async () => {
    const el = await mount();

    await click(q(el, 'memory-body').querySelector('[data-memory-link="deploys.md"]'));

    expect(api.getWorkspaceMemory).toHaveBeenLastCalledWith('ws1', 'deploys.md');
    expect(text(q(el, 'memory-name'))).toBe('deploys.md');
    expect(q(el, 'memory-body').querySelector('strong').textContent).toBe('carefully');
    expect(q(el, 'memory-unlinked')).toBeNull();

    await click(q(el, 'memory-back'));
    expect(text(q(el, 'memory-name'))).toBe('MEMORY.md');
    expect(q(el, 'memory-back')).toBeNull();
  });

  it('opens a memory from the list under the index', async () => {
    const el = await mount();

    await click(el.querySelector('[data-test="memory-unlinked-item"]'));

    expect(text(q(el, 'memory-name'))).toBe('orphan.md');
    expect(text(q(el, 'memory-body'))).toBe('Nobody links here.');
  });

  it('says in place when a link names a memory nobody saved', async () => {
    const el = await mount();

    await click(q(el, 'memory-body').querySelector('[data-memory-link="later.md"]'));

    expect(text(q(el, 'memory-missing'))).toBe('Nothing saved under later.md yet.');
    expect(q(el, 'memory-back')).not.toBeNull();
  });

  it('shows the raw markdown on request', async () => {
    const el = await mount();

    await click(q(el, 'memory-raw'));

    expect(q(el, 'memory-raw-body').textContent).toBe(CONTENT['memory.md']);
    expect(q(el, 'memory-raw').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps its buttons to icons on a phone, with names for a screen reader', async () => {
    const el = await mount();
    await click(q(el, 'memory-body').querySelector('[data-memory-link="deploys.md"]'));

    for (const button of [q(el, 'memory-back'), q(el, 'memory-raw')]) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.querySelector('svg').getAttribute('class')).toContain('sm:hidden');
      expect(button.querySelector('span').getAttribute('class')).toContain('hidden sm:inline');
    }
  });

  it('says there is no index yet and lists every memory instead', async () => {
    MEMORIES = [{ name: 'deploys.md' }, { name: 'orphan.md' }];
    const el = await mount();

    expect(api.getWorkspaceMemory).not.toHaveBeenCalled();
    expect(text(q(el, 'memory-no-index'))).toBe('MEMORY.md is not written yet, so nothing indexes these.');
    expect(unlinked(el)).toEqual(['deploys.md', 'orphan.md']);

    await click(el.querySelector('[data-test="memory-unlinked-item"]'));
    expect(text(q(el, 'memory-name'))).toBe('deploys.md');

    await click(q(el, 'memory-back'));
    expect(q(el, 'memory-no-index')).not.toBeNull();
  });

  it('reads an empty workspace as nothing yet, with no box inside the card on a phone', async () => {
    MEMORIES = [];
    const el = await mount();

    const empty = q(el, 'memories-empty');
    expect(text(empty)).toContain('Nothing remembered yet.');
    expect(empty.className.split(' ').filter((c) => /^(p-|bg-|border|rounded)/.test(c))).toEqual([]);
  });

  it('tells a failed fetch apart from an empty workspace, and tries again', async () => {
    api.fetchWorkspaceMemories.mockRejectedValueOnce(new Error('offline'));
    const el = await mount();

    expect(text(q(el, 'memories-failed'))).toContain("Could not load this workspace's memories.");
    expect(q(el, 'memories-empty')).toBeNull();

    await click(q(el, 'memories-failed').querySelector('button'));
    expect(text(q(el, 'memory-name'))).toBe('MEMORY.md');
  });

  it('reports a memory that would not load', async () => {
    api.getWorkspaceMemory.mockRejectedValue(new Error('offline'));
    const el = await mount();

    expect(text(q(el, 'memory-error'))).toBe('Could not load this memory.');
    expect(q(el, 'memory-unlinked')).toBeNull();
  });
});
