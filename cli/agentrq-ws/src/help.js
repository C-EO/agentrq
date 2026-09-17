// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { COMMANDS } from './commands.js'
import { VERSION } from './version.js'

export const GLOBAL_OPTIONS = {
  json: { type: 'boolean', description: 'Print the raw JSON result instead of text' },
  server: { type: 'string', description: 'Which server in .mcp.json to use' },
  config: { type: 'string', description: 'Path to an .mcp.json (default: nearest one upwards)' },
  help: { type: 'boolean', short: 'h', description: 'Show help for a command' },
  version: { type: 'boolean', short: 'V', description: 'Print the version' },
}

const pad = (text, width) => text + ' '.repeat(Math.max(0, width - text.length))

function renderOptions(options) {
  const entries = Object.entries(options || {})
  if (entries.length === 0) return ''
  const rendered = entries.map(([name, spec]) => {
    const flags = `--${name}${spec.short ? `, -${spec.short}` : ''}${spec.type === 'string' ? ' <value>' : ''}`
    return [flags, spec.description || '']
  })
  const width = Math.max(...rendered.map(([flags]) => flags.length))
  return rendered.map(([flags, description]) => `  ${pad(flags, width)}  ${description}`).join('\n')
}

/** Help for one command. */
export function commandHelp(command) {
  const lines = [command.summary, '', `Usage: ${command.usage}`]
  const options = renderOptions(command.options)
  if (options) lines.push('', 'Options:', options)
  lines.push('', 'Global options:', renderOptions(GLOBAL_OPTIONS))
  return lines.join('\n')
}

/** Help for a family of commands, such as `task` or `memory`. */
export function groupHelp({ segments, members }) {
  const name = segments.join(' ')
  const width = Math.max(...members.map((c) => c.path.join(' ').length))
  const list = members.map((c) => `  ${pad(c.path.join(' '), width)}  ${c.summary}`).join('\n')
  return [
    `Usage: agentrq-ws ${name} <command>`,
    '',
    `Commands:`,
    list,
    '',
    `Run \`agentrq-ws help ${name} <command>\` for one of them.`,
  ].join('\n')
}

/** The top-level help, generated from the command table so it cannot go stale. */
export function mainHelp() {
  const width = Math.max(...COMMANDS.map((c) => c.path.join(' ').length))
  const list = COMMANDS.map((c) => `  ${pad(c.path.join(' '), width)}  ${c.summary}`).join('\n')
  return `agentrq-ws ${VERSION} — AgentRQ workspace client

Drives the workspace named by the .mcp.json in the current directory (or the
nearest one above it), using the same tools an agent would, without spending an
agent's tokens to do it.

Usage: agentrq-ws <command> [options]

Commands:
${list}
  ${pad('help', width)}  Show this help, or help for a command

Global options:
${renderOptions(GLOBAL_OPTIONS)}

Text arguments accept @path to read a file and - to read stdin.
Attachments are given as plain file paths; downloads are written to disk and
the path is printed. You never handle base64.

Examples:
  agentrq-ws workspace
  agentrq-ws task next
  agentrq-ws task create "Ship the CLI" --body @notes.md --attach ./diagram.png
  agentrq-ws reply 0isnjTCkpW5 "Done — logs attached" --attach ./run.log
  agentrq-ws attachment get att-42 --task 0isnjTCkpW5 --out ~/Downloads
  agentrq-ws memory load
  echo "the full note" | agentrq-ws memory save release-notes.md --content -

Environment:
  AGENTRQ_WS_URL     Use this server URL instead of reading .mcp.json
  AGENTRQ_WS_SERVER  Which server in .mcp.json to use`
}
