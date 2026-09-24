// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * Workspace settings tabs and their editing policies.
 *
 * The settings screen is shared between tabs that edit workspace properties
 * (persisted through `updateWorkspace`), read-only information screens (setup
 * guides, agent memories), dedicated integration flows (slack), and
 * destructive actions (danger zone).
 *
 * The bottom action bar carrying "Cancel" and "Update Workspace" belongs only
 * to the editable tabs of an active workspace.
 */

/**
 * Tabs on the workspace settings screen with form fields that save changes via
 * the bottom action bar.
 */
export const EDITABLE_SETTINGS_TABS = Object.freeze([
  'general',
  'automations',
  'notifications',
]);

/**
 * Tabs on the workspace settings screen that are read-only views.
 */
export const READ_ONLY_SETTINGS_TABS = Object.freeze([
  'setup',
  'memories',
]);

/**
 * Reports whether a given settings tab is read-only.
 *
 * @param {string} tab
 * @returns {boolean}
 */
export function isReadOnlySettingsTab(tab) {
  return READ_ONLY_SETTINGS_TABS.includes(tab);
}

/**
 * Determines whether the bottom action bar (Cancel and Update Workspace buttons)
 * should be displayed.
 *
 * The action bar is shown only for editable tabs. Read-only tabs (setup,
 * memories), custom-action tabs (slack, danger), and archived workspaces omit
 * it.
 *
 * @param {string} tab The ID of the currently active tab.
 * @param {{ archivedAt?: string | null } | boolean | null} [workspaceOrArchived] Workspace object or boolean archive flag.
 * @returns {boolean}
 */
export function shouldShowSettingsActionBar(tab, workspaceOrArchived = null) {
  if (!EDITABLE_SETTINGS_TABS.includes(tab)) {
    return false;
  }
  if (typeof workspaceOrArchived === 'boolean') {
    return !workspaceOrArchived;
  }
  if (workspaceOrArchived && Boolean(workspaceOrArchived.archivedAt)) {
    return false;
  }
  return true;
}

/**
 * The MCP server key the core (non-workspace-scoped) server is written under
 * in a "supervisor" workspace's `.mcp.json` and permissions snippets.
 */
const SUPERVISOR_MCP_SERVER_NAME = 'agentrq';

/**
 * Builds the `.claude/settings.local.json` contents shown on the setup tab.
 *
 * Each server is allowed with a single `mcp__<server>__*` wildcard rather than
 * tool by tool, so a tool added on the server needs no change here. The server
 * name has to match the key used in `.mcp.json`, since that is what Claude Code
 * prefixes onto each tool to form the permission entry.
 *
 * A workspace named exactly "supervisor" also gets the `agentrq` core server
 * allowed and enabled, matching the second `.mcp.json` entry `buildMcpServers`
 * writes for it.
 *
 * @param {string} serverName The MCP server key, e.g. `agentrq-0ZzhYQG2qtl`.
 * @param {string} [workspaceName] The workspace's name, checked for the exact
 *   "supervisor" case.
 * @returns {{permissions: {allow: string[]}, enableAllProjectMcpServers: boolean, enabledMcpjsonServers: string[]}}
 */
export function buildClaudePermissionsConfig(serverName, workspaceName) {
  const enabledMcpjsonServers = [serverName];
  if (workspaceName === 'supervisor') {
    enabledMcpjsonServers.push(SUPERVISOR_MCP_SERVER_NAME);
  }
  return {
    permissions: { allow: enabledMcpjsonServers.map((name) => `mcp__${name}__*`) },
    enableAllProjectMcpServers: true,
    enabledMcpjsonServers,
  };
}

/**
 * Builds the URL of the core (non-workspace-scoped) MCP server — the one the
 * cross-workspace tools such as `createTask` are served from — by templating
 * it the same way the backend templates the per-workspace one.
 *
 * The per-workspace URL a deployment with subdomain masking returns is
 * `{proto}://{id36}.mcp.{domain}`; the core server lives at the bare
 * `{proto}://mcp.{domain}/mcp`, so the workspace id label is stripped off
 * rather than the hostname being rebuilt from scratch. A deployment with no
 * subdomain masking (dev, localhost) returns `{origin}/mcp/{workspaceId}`
 * instead, and the core server is the same origin's bare `/mcp` path.
 *
 * @param {{ workspaceMcpUrl?: string, origin: string, basePath?: string }} args
 * @returns {string}
 */
export function buildSupervisorMcpUrl({ workspaceMcpUrl, origin, basePath = '' }) {
  const cleanBase = (basePath || '').replace(/\/$/, '');
  if (workspaceMcpUrl && workspaceMcpUrl.includes('.mcp.')) {
    const base = workspaceMcpUrl.split('?')[0];
    return `${base.replace(/^(https?:\/\/)[^/]+\.mcp\./, '$1mcp.')}/mcp`;
  }
  return `${origin}${cleanBase}/mcp`;
}

/**
 * Builds the `mcpServers` map for the setup tab's `.mcp.json` snippet.
 *
 * A workspace named exactly "supervisor" gets a second entry, `agentrq`,
 * pointing at the core MCP server, so the agent working that workspace also
 * has the cross-workspace tools available. It carries no token: the core
 * server authenticates over its own OAuth flow, not the per-workspace
 * bearer token the regular entry's URL carries.
 *
 * @param {{ serverName: string, authenticatedUrl: string, workspaceName?: string, supervisorMcpUrl: string }} args
 * @returns {Record<string, { type: 'http', url: string }>}
 */
export function buildMcpServers({ serverName, authenticatedUrl, workspaceName, supervisorMcpUrl }) {
  const servers = {
    [serverName]: { type: 'http', url: authenticatedUrl },
  };
  if (workspaceName === 'supervisor') {
    servers[SUPERVISOR_MCP_SERVER_NAME] = { type: 'http', url: supervisorMcpUrl };
  }
  return servers;
}
