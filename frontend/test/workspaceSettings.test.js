// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  EDITABLE_SETTINGS_TABS,
  READ_ONLY_SETTINGS_TABS,
  SUPERVISOR_MCP_TOOLS,
  WORKSPACE_MCP_TOOLS,
  buildClaudePermissionsConfig,
  buildMcpServers,
  buildSupervisorMcpUrl,
  isReadOnlySettingsTab,
  shouldShowSettingsActionBar,
} from '../src/composables/useWorkspaceSettings';

const SERVER_GO = 'backend/internal/controller/mcp/server.go';
const COREMCP_DIR = 'backend/internal/handler/coremcp';

/**
 * Locates the Go MCP server's source by walking up from the working directory.
 *
 * The path is not derived from `import.meta.url`: these tests run under jsdom,
 * where that is an http URL rather than a file one.
 */
function serverSourcePath() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = resolve(dir, SERVER_GO);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dirname(dir) === dir) {
      throw new Error(`could not find ${SERVER_GO} above ${process.cwd()}`);
    }
  }
}

/**
 * The tool names the Go MCP server registers, read straight out of its source.
 *
 * Every `Name:` in that file belongs to an `mcp.AddTool` call, but the call is
 * matched explicitly so that a `Name` field added elsewhere later cannot quietly
 * inflate this list.
 */
function toolsRegisteredByServer() {
  const source = readFileSync(serverSourcePath(), 'utf-8');
  return [...source.matchAll(/mcp\.AddTool\(mcpSrv, &mcp\.Tool\{\s*Name:\s*"([^"]+)"/g)]
    .map((match) => match[1]);
}

/**
 * Locates the coremcp package's directory by walking up from the working
 * directory, the same way `serverSourcePath` locates the workspace server.
 */
function coremcpDirPath() {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = resolve(dir, COREMCP_DIR);
    if (existsSync(candidate)) {
      return candidate;
    }
    if (dirname(dir) === dir) {
      throw new Error(`could not find ${COREMCP_DIR} above ${process.cwd()}`);
    }
  }
}

/**
 * The tool names the core MCP server registers, across every non-test file in
 * the package — it registers across `server.go`, `events.go` and
 * `workflows.go`, and reading only one would miss two thirds of the surface.
 * Mirrors `registeredUnder` in `desktop/test/extensions/servers.test.js`,
 * which guards the same Go source for the desktop app.
 */
function toolsRegisteredByCoremcp() {
  const dir = coremcpDirPath();
  const re = /mcp\.AddTool\(s\.server, &mcp\.Tool\{\s*Name:\s*"([^"]+)"/g;
  return readdirSync(dir)
    .filter((name) => name.endsWith('.go') && !name.endsWith('_test.go'))
    .flatMap((name) => [...readFileSync(resolve(dir, name), 'utf-8').matchAll(re)].map((match) => match[1]));
}

describe('useWorkspaceSettings', () => {
  describe('tab classification constants', () => {
    it('defines editable tabs that persist form state', () => {
      expect(EDITABLE_SETTINGS_TABS).toEqual(['general', 'automations', 'notifications']);
    });

    it('defines read-only tabs that only display information', () => {
      expect(READ_ONLY_SETTINGS_TABS).toEqual(['setup', 'memories']);
    });
  });

  describe('isReadOnlySettingsTab', () => {
    it('identifies memories and setup as read-only', () => {
      expect(isReadOnlySettingsTab('memories')).toBe(true);
      expect(isReadOnlySettingsTab('setup')).toBe(true);
    });

    it('returns false for editable or action-based tabs', () => {
      expect(isReadOnlySettingsTab('general')).toBe(false);
      expect(isReadOnlySettingsTab('automations')).toBe(false);
      expect(isReadOnlySettingsTab('notifications')).toBe(false);
      expect(isReadOnlySettingsTab('slack')).toBe(false);
      expect(isReadOnlySettingsTab('danger')).toBe(false);
    });

    it('returns false for unknown or missing tabs', () => {
      expect(isReadOnlySettingsTab('unknown')).toBe(false);
      expect(isReadOnlySettingsTab(undefined)).toBe(false);
      expect(isReadOnlySettingsTab(null)).toBe(false);
    });
  });

  describe('shouldShowSettingsActionBar', () => {
    it('shows action bar for editable tabs in active workspaces', () => {
      expect(shouldShowSettingsActionBar('general')).toBe(true);
      expect(shouldShowSettingsActionBar('automations')).toBe(true);
      expect(shouldShowSettingsActionBar('notifications')).toBe(true);

      const activeWorkspace = { id: 'ws1', name: 'Active Workspace', archivedAt: null };
      expect(shouldShowSettingsActionBar('general', activeWorkspace)).toBe(true);
      expect(shouldShowSettingsActionBar('automations', activeWorkspace)).toBe(true);
      expect(shouldShowSettingsActionBar('notifications', activeWorkspace)).toBe(true);

      expect(shouldShowSettingsActionBar('general', false)).toBe(true);
    });

    it('hides action bar on read-only tabs like memories and setup', () => {
      expect(shouldShowSettingsActionBar('memories')).toBe(false);
      expect(shouldShowSettingsActionBar('setup')).toBe(false);

      const activeWorkspace = { id: 'ws1', archivedAt: null };
      expect(shouldShowSettingsActionBar('memories', activeWorkspace)).toBe(false);
      expect(shouldShowSettingsActionBar('setup', activeWorkspace)).toBe(false);
    });

    it('hides action bar on dedicated action tabs like slack and danger', () => {
      expect(shouldShowSettingsActionBar('slack')).toBe(false);
      expect(shouldShowSettingsActionBar('danger')).toBe(false);
    });

    it('hides action bar for unknown tabs', () => {
      expect(shouldShowSettingsActionBar('custom')).toBe(false);
      expect(shouldShowSettingsActionBar('')).toBe(false);
      expect(shouldShowSettingsActionBar(null)).toBe(false);
    });

    it('hides action bar when workspace is archived, even on editable tabs', () => {
      const archivedWorkspace = { id: 'ws1', archivedAt: '2026-09-01T12:00:00Z' };
      expect(shouldShowSettingsActionBar('general', archivedWorkspace)).toBe(false);
      expect(shouldShowSettingsActionBar('automations', archivedWorkspace)).toBe(false);
      expect(shouldShowSettingsActionBar('notifications', archivedWorkspace)).toBe(false);

      // Boolean flag overload
      expect(shouldShowSettingsActionBar('general', true)).toBe(false);
    });
  });

  describe('WORKSPACE_MCP_TOOLS', () => {
    it('lists every tool the MCP server registers, in the same order', () => {
      expect(WORKSPACE_MCP_TOOLS).toEqual(toolsRegisteredByServer());
    });

    it('names the tools an agent needs to work a task end to end', () => {
      expect(WORKSPACE_MCP_TOOLS).toEqual([
        'createTask',
        'updateTaskStatus',
        'reply',
        'downloadAttachment',
        'getWorkspace',
        'getTask',
        'publishEvent',
        'loadMemory',
        'saveMemory',
        'deleteMemory',
        'searchSkills',
        'loadSkill',
        'saveSkill',
        'deleteSkill',
        'elicit',
      ]);
    });

    it('is frozen, so a caller cannot mutate the shared list', () => {
      expect(Object.isFrozen(WORKSPACE_MCP_TOOLS)).toBe(true);
    });
  });

  describe('SUPERVISOR_MCP_TOOLS', () => {
    it('is exactly what the core (coremcp) server registers, across every file', () => {
      expect([...SUPERVISOR_MCP_TOOLS].sort()).toEqual(toolsRegisteredByCoremcp().sort());
    });

    it('is frozen, so a caller cannot mutate the shared list', () => {
      expect(Object.isFrozen(SUPERVISOR_MCP_TOOLS)).toBe(true);
    });
  });

  describe('buildClaudePermissionsConfig', () => {
    it('prefixes every tool with the MCP server name', () => {
      const { permissions } = buildClaudePermissionsConfig('agentrq-ws1');

      expect(permissions.allow).toEqual([
        'mcp__agentrq-ws1__createTask',
        'mcp__agentrq-ws1__updateTaskStatus',
        'mcp__agentrq-ws1__reply',
        'mcp__agentrq-ws1__downloadAttachment',
        'mcp__agentrq-ws1__getWorkspace',
        'mcp__agentrq-ws1__getTask',
        'mcp__agentrq-ws1__publishEvent',
        'mcp__agentrq-ws1__loadMemory',
        'mcp__agentrq-ws1__saveMemory',
        'mcp__agentrq-ws1__deleteMemory',
        'mcp__agentrq-ws1__searchSkills',
        'mcp__agentrq-ws1__loadSkill',
        'mcp__agentrq-ws1__saveSkill',
        'mcp__agentrq-ws1__deleteSkill',
        'mcp__agentrq-ws1__elicit',
      ]);
    });

    it('pre-approves every registered tool, leaving no prompt behind', () => {
      const { permissions } = buildClaudePermissionsConfig('agentrq-ws1');

      expect(permissions.allow).toHaveLength(toolsRegisteredByServer().length);
    });

    it('enables the project MCP servers and names this one', () => {
      const config = buildClaudePermissionsConfig('agentrq-ws1');

      expect(config.enableAllProjectMcpServers).toBe(true);
      expect(config.enabledMcpjsonServers).toEqual(['agentrq-ws1']);
    });

    it('serialises to the snippet shape the setup tab displays', () => {
      const config = buildClaudePermissionsConfig('agentrq-ws1');

      expect(Object.keys(config)).toEqual([
        'permissions',
        'enableAllProjectMcpServers',
        'enabledMcpjsonServers',
      ]);
      expect(JSON.parse(JSON.stringify(config))).toEqual(config);
    });

    it('does not add core-server tools when no workspace name is given', () => {
      const config = buildClaudePermissionsConfig('agentrq-ws1');

      expect(config.permissions.allow).toHaveLength(WORKSPACE_MCP_TOOLS.length);
      expect(config.enabledMcpjsonServers).toEqual(['agentrq-ws1']);
    });

    it('does not add core-server tools for a workspace that is not named exactly "supervisor"', () => {
      const config = buildClaudePermissionsConfig('agentrq-ws1', 'Supervisor');

      expect(config.permissions.allow).toHaveLength(WORKSPACE_MCP_TOOLS.length);
      expect(config.enabledMcpjsonServers).toEqual(['agentrq-ws1']);
    });

    it('adds every core-server tool and enables the "agentrq" server for a supervisor workspace', () => {
      const config = buildClaudePermissionsConfig('agentrq-ws1', 'supervisor');

      expect(config.permissions.allow).toHaveLength(WORKSPACE_MCP_TOOLS.length + SUPERVISOR_MCP_TOOLS.length);
      SUPERVISOR_MCP_TOOLS.forEach((tool) => {
        expect(config.permissions.allow).toContain(`mcp__agentrq__${tool}`);
      });
      expect(config.enabledMcpjsonServers).toEqual(['agentrq-ws1', 'agentrq']);
    });
  });

  describe('buildSupervisorMcpUrl', () => {
    it('rewrites a subdomain-based workspace mcpUrl to the bare mcp.<domain>/mcp host', () => {
      const url = buildSupervisorMcpUrl({
        workspaceMcpUrl: 'https://a1b2.mcp.agentrq.com',
        origin: 'https://app.agentrq.com',
        basePath: '',
      });

      expect(url).toBe('https://mcp.agentrq.com/mcp');
    });

    it('preserves http and strips any query string before templating', () => {
      const url = buildSupervisorMcpUrl({
        workspaceMcpUrl: 'http://a1b2.mcp.example.internal?token=secret',
        origin: 'http://app.example.internal',
        basePath: '',
      });

      expect(url).toBe('http://mcp.example.internal/mcp');
    });

    it('falls back to the origin-based bare /mcp path when there is no subdomain masking', () => {
      const url = buildSupervisorMcpUrl({
        workspaceMcpUrl: 'http://localhost:8080/mcp/abc123',
        origin: 'http://localhost:8080',
        basePath: '',
      });

      expect(url).toBe('http://localhost:8080/mcp');
    });

    it('honors a configured base path in the fallback case', () => {
      const url = buildSupervisorMcpUrl({
        workspaceMcpUrl: '',
        origin: 'https://app.agentrq.com',
        basePath: '/abc/def/',
      });

      expect(url).toBe('https://app.agentrq.com/abc/def/mcp');
    });
  });

  describe('buildMcpServers', () => {
    it('writes a single entry for a regular workspace', () => {
      const servers = buildMcpServers({
        serverName: 'agentrq-ws1',
        authenticatedUrl: 'https://a1b2.mcp.agentrq.com?token=tok',
        workspaceName: 'My Workspace',
        supervisorMcpUrl: 'https://mcp.agentrq.com/mcp',
      });

      expect(servers).toEqual({
        'agentrq-ws1': { type: 'http', url: 'https://a1b2.mcp.agentrq.com?token=tok' },
      });
    });

    it('adds a second "agentrq" entry for a workspace named exactly "supervisor"', () => {
      const servers = buildMcpServers({
        serverName: 'agentrq-ws1',
        authenticatedUrl: 'https://a1b2.mcp.agentrq.com?token=tok',
        workspaceName: 'supervisor',
        supervisorMcpUrl: 'https://mcp.agentrq.com/mcp',
      });

      expect(servers).toEqual({
        'agentrq-ws1': { type: 'http', url: 'https://a1b2.mcp.agentrq.com?token=tok' },
        agentrq: { type: 'http', url: 'https://mcp.agentrq.com/mcp' },
      });
    });

    it('does not add the second entry for a name that only looks like supervisor', () => {
      const servers = buildMcpServers({
        serverName: 'agentrq-ws1',
        authenticatedUrl: 'https://a1b2.mcp.agentrq.com?token=tok',
        workspaceName: 'Supervisor',
        supervisorMcpUrl: 'https://mcp.agentrq.com/mcp',
      });

      expect(Object.keys(servers)).toEqual(['agentrq-ws1']);
    });
  });
});
