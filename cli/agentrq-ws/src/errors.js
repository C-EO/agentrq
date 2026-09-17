// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

/**
 * An error caused by how the command was invoked or configured, rather than a
 * fault in the CLI. These print as a plain message with no stack trace: a
 * missing .mcp.json is not a crash, and showing somebody a stack for one
 * teaches them to ignore stacks.
 */
export class UserError extends Error {
  constructor(message, { exitCode = 1 } = {}) {
    super(message)
    this.name = 'UserError'
    this.exitCode = exitCode
  }
}

/** An error reported by the workspace server, either as HTTP or as a tool result. */
export class ServerError extends Error {
  constructor(message, { status } = {}) {
    super(message)
    this.name = 'ServerError'
    this.status = status
    this.exitCode = 1
  }
}
