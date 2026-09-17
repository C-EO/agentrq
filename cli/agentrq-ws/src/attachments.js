// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'

import { UserError } from './errors.js'

/**
 * Extension → media type. Deliberately a short table of what actually gets
 * attached to a task rather than a dependency: anything unlisted travels as
 * application/octet-stream, which is correct, just unspecific.
 */
export const MIME_TYPES = {
  '.bmp': 'image/bmp',
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.gz': 'application/gzip',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.ics': 'text/calendar',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tar': 'application/x-tar',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.zip': 'application/zip',
}

export function mimeTypeFor(filename) {
  return MIME_TYPES[extname(String(filename)).toLowerCase()] || 'application/octet-stream'
}

/**
 * Turn a path on disk into the attachment shape the workspace tools expect.
 *
 * This is the whole point of the `--attach` flag: the wire format wants
 * `{id, filename, mimeType, data}` with base64 in `data`, and nobody should
 * have to produce that by hand. The `id` is a placeholder — the backend mints
 * the real one and blanks `data` as it stores the bytes — but the field is part
 * of the schema, so it is sent.
 */
export function readAttachment(filePath, { readFile = readFileSync, stat = statSync } = {}) {
  const path = resolve(filePath)
  let info
  try {
    info = stat(path)
  } catch {
    throw new UserError(`cannot attach ${filePath}: no such file`)
  }
  if (info.isDirectory()) {
    throw new UserError(`cannot attach ${filePath}: it is a directory`)
  }
  let bytes
  try {
    bytes = readFile(path)
  } catch (err) {
    throw new UserError(`cannot read ${filePath}: ${err.message}`)
  }
  const filename = basename(path)
  return {
    id: `upload-${filename}`,
    filename,
    mimeType: mimeTypeFor(filename),
    data: Buffer.from(bytes).toString('base64'),
  }
}

/**
 * Index the attachments mentioned in a task's text, id → {filename, mimeType}.
 *
 * `downloadAttachment` answers with base64 and nothing else — no name, no type
 * — so the only way to save a file under the name a human gave it is to read
 * the task first. Task-level attachments arrive as `- id=… name=… type=…`
 * lines and message-level ones inside the conversation JSON, so both shapes are
 * scanned.
 */
export function indexAttachments(taskText) {
  const index = new Map()
  const text = String(taskText || '')

  const linePattern = /^\s*-\s*id=(\S+)\s+name=(.*?)\s+type=(\S+)\s*$/gm
  for (const match of text.matchAll(linePattern)) {
    index.set(match[1], { filename: match[2], mimeType: match[3] })
  }

  const jsonPattern = /"id"\s*:\s*"([^"]+)"\s*,\s*"filename"\s*:\s*"([^"]*)"\s*,\s*"mimeType"\s*:\s*"([^"]*)"/g
  for (const match of text.matchAll(jsonPattern)) {
    if (!index.has(match[1])) {
      index.set(match[1], { filename: match[2], mimeType: match[3] })
    }
  }
  return index
}

/**
 * Work out where a downloaded attachment should land.
 *
 * With no `--out` it goes to the OS temp directory, which is what makes
 * `attachment get` safe to run without thinking about the current directory.
 * An `--out` naming an existing directory (or ending in a separator) keeps the
 * attachment's own filename; anything else is taken as the full path to write,
 * so `--out ./report.pdf` renames.
 */
export function resolveOutputPath(filename, out, { cwd = process.cwd(), temp = tmpdir(), stat = statSync } = {}) {
  const safeName = basename(String(filename || '')) || 'attachment'
  if (!out) return join(temp, safeName)

  const endsWithSeparator = /[\\/]$/.test(out)
  const target = isAbsolute(out) ? out : resolve(cwd, out)
  if (endsWithSeparator || isDirectory(target, stat)) {
    return join(target, safeName)
  }
  return target
}

/** True only when the path exists *and* is a directory — an existing file at
 * `--out` is a rename target to overwrite, not somewhere to nest inside. */
function isDirectory(path, stat) {
  try {
    return stat(path).isDirectory()
  } catch {
    return false
  }
}

/** Write base64 content to `path`, creating the directory if it is missing. */
export function writeAttachment(path, base64, { write = writeFileSync, mkdir = mkdirSync } = {}) {
  const buffer = Buffer.from(String(base64 || '').trim(), 'base64')
  try {
    mkdir(dirname(path), { recursive: true })
    write(path, buffer)
  } catch (err) {
    throw new UserError(`cannot write ${path}: ${err.message}`)
  }
  return { path, bytes: buffer.length }
}
