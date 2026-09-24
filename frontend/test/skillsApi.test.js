// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { describe, it, expect, vi, afterEach } from 'vitest';

import { importWorkspaceSkills, searchWorkspaceSkills } from '../src/api';

// The search query travels in the URL, relative so the desktop app's proxy
// carries it, with only the parameters that were given.
describe('searchWorkspaceSkills', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends only what was asked for', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn((url) => {
      seen.push(url);
      return Promise.resolve(new Response(JSON.stringify({ skills: [], total: 0 }), { status: 200 }));
    }));

    await searchWorkspaceSkills('ws1');
    await searchWorkspaceSkills('ws1', { q: 'pull request', limit: 20, offset: 40 });
    expect(seen).toEqual([
      '/api/v1/workspaces/ws1/skills',
      '/api/v1/workspaces/ws1/skills?q=pull+request&limit=20&offset=40',
    ]);
  });

  it('passes the server\'s refusal on, with its status', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'search query "ab" is too short' } }), { status: 422 })),
    ));
    await expect(searchWorkspaceSkills('ws1', { q: 'ab' })).rejects.toMatchObject({ message: 'search query "ab" is too short', status: 422 });
  });
});

// The skills chosen from a repository too large to import whole go in the
// body; without a choice the body is what it always was.
describe('importWorkspaceSkills', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names the chosen skills only when there are some', async () => {
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      bodies.push(JSON.parse(init.body));
      return Promise.resolve(new Response(JSON.stringify({ imported: [], skipped: [] }), { status: 200 }));
    }));

    await importWorkspaceSkills('ws1', 'https://github.com/a/b');
    await importWorkspaceSkills('ws1', 'https://github.com/a/b', true, []);
    await importWorkspaceSkills('ws1', 'https://github.com/a/b', false, ['ship', 'tools/guard']);
    expect(bodies).toEqual([
      { url: 'https://github.com/a/b', overwrite: false },
      { url: 'https://github.com/a/b', overwrite: true },
      { url: 'https://github.com/a/b', overwrite: false, skills: ['ship', 'tools/guard'] },
    ]);
  });
});
