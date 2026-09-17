// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  indexAttachments,
  mimeTypeFor,
  readAttachment,
  resolveOutputPath,
  writeAttachment,
} from '../src/attachments.js'
import { UserError } from '../src/errors.js'

const scratch = () => mkdtempSync(join(tmpdir(), 'agentrq-ws-att-'))

test('mimeTypeFor knows the common types and is not upset by the rest', () => {
  assert.equal(mimeTypeFor('report.pdf'), 'application/pdf')
  assert.equal(mimeTypeFor('SHOUT.PNG'), 'image/png')
  assert.equal(mimeTypeFor('notes.md'), 'text/markdown')
  assert.equal(mimeTypeFor('archive.tar'), 'application/x-tar')
  assert.equal(mimeTypeFor('mystery.qqq'), 'application/octet-stream')
  assert.equal(mimeTypeFor('no-extension'), 'application/octet-stream')
})

test('readAttachment turns a path into the wire shape, base64 included', () => {
  // This is the whole point of --attach: the user names a file, never base64.
  const dir = scratch()
  const path = join(dir, 'hello.txt')
  writeFileSync(path, 'hello\n')

  const attachment = readAttachment(path)
  assert.equal(attachment.filename, 'hello.txt')
  assert.equal(attachment.mimeType, 'text/plain')
  assert.equal(Buffer.from(attachment.data, 'base64').toString(), 'hello\n')
  assert.ok(attachment.id, 'an id is sent even though the backend mints the real one')
})

test('readAttachment handles binary content byte for byte', () => {
  const dir = scratch()
  const path = join(dir, 'blob.bin')
  const bytes = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f])
  writeFileSync(path, bytes)
  assert.deepEqual(Buffer.from(readAttachment(path).data, 'base64'), bytes)
})

test('readAttachment explains a missing file and a directory', () => {
  const dir = scratch()
  assert.throws(() => readAttachment(join(dir, 'nope.txt')), /no such file/)
  assert.throws(() => readAttachment(dir), /it is a directory/)
})

test('readAttachment reports an unreadable file', () => {
  const dir = scratch()
  const path = join(dir, 'locked.txt')
  writeFileSync(path, 'x')
  const readFile = () => {
    throw new Error('EACCES')
  }
  assert.throws(() => readAttachment(path, { readFile }), /cannot read .*EACCES/)
})

test('indexAttachments reads the task listing form', () => {
  const text = ['Task details:', 'Attachments:', '  - id=0isp9 name=report.pdf type=application/pdf'].join('\n')
  assert.deepEqual(indexAttachments(text).get('0isp9'), {
    filename: 'report.pdf',
    mimeType: 'application/pdf',
  })
})

test('indexAttachments reads the conversation JSON form', () => {
  // Message attachments arrive as JSON inside the conversation, not as lines.
  const text = '{"attachments":[{"id":"0isp9dJxr85","filename":"run.log","mimeType":"text/plain"}]}'
  assert.deepEqual(indexAttachments(text).get('0isp9dJxr85'), {
    filename: 'run.log',
    mimeType: 'text/plain',
  })
})

test('indexAttachments lets the task listing win over a later JSON mention', () => {
  const text = [
    '  - id=dup name=canonical.txt type=text/plain',
    '{"id":"dup","filename":"other.txt","mimeType":"text/plain"}',
  ].join('\n')
  assert.equal(indexAttachments(text).get('dup').filename, 'canonical.txt')
})

test('indexAttachments is empty for a task with no attachments', () => {
  assert.equal(indexAttachments('Task details:\nID: x').size, 0)
  assert.equal(indexAttachments(null).size, 0)
})

test('resolveOutputPath defaults to the OS temp directory', () => {
  // Asked for explicitly: with no --out the file lands somewhere predictable
  // and the path gets printed.
  assert.equal(resolveOutputPath('report.pdf', undefined, { temp: '/tmp' }), '/tmp/report.pdf')
})

test('resolveOutputPath keeps the filename when --out is a directory', () => {
  const dir = scratch()
  assert.equal(resolveOutputPath('report.pdf', dir), join(dir, 'report.pdf'))
})

test('resolveOutputPath treats a trailing separator as a directory even if absent', () => {
  const dir = join(scratch(), 'not-yet')
  assert.equal(resolveOutputPath('report.pdf', `${dir}/`), join(dir, 'report.pdf'))
})

test('resolveOutputPath renames when --out is a file path', () => {
  const dir = scratch()
  assert.equal(resolveOutputPath('report.pdf', join(dir, 'renamed.pdf')), join(dir, 'renamed.pdf'))
})

test('resolveOutputPath overwrites an existing file rather than nesting inside it', () => {
  const dir = scratch()
  const path = join(dir, 'existing.txt')
  writeFileSync(path, 'old')
  assert.equal(resolveOutputPath('report.pdf', path), path)
})

test('resolveOutputPath resolves a relative --out against the working directory', () => {
  const dir = scratch()
  assert.equal(resolveOutputPath('a.txt', 'sub/dir.txt', { cwd: dir }), join(dir, 'sub/dir.txt'))
})

test('resolveOutputPath falls back to a name when the attachment has none', () => {
  assert.equal(resolveOutputPath('', undefined, { temp: '/tmp' }), '/tmp/attachment')
  assert.equal(resolveOutputPath(null, undefined, { temp: '/tmp' }), '/tmp/attachment')
})

test('resolveOutputPath strips a path out of the attachment filename', () => {
  // The name comes from the server; it must not be able to steer the write.
  assert.equal(resolveOutputPath('../../etc/passwd', undefined, { temp: '/tmp' }), '/tmp/passwd')
})

test('writeAttachment decodes base64 to disk and reports the size', () => {
  const dir = scratch()
  const path = join(dir, 'out.txt')
  const result = writeAttachment(path, Buffer.from('hello\n').toString('base64'))
  assert.equal(readFileSync(path, 'utf8'), 'hello\n')
  assert.deepEqual(result, { path, bytes: 6 })
})

test('writeAttachment creates the destination directory', () => {
  const dir = scratch()
  const path = join(dir, 'deep', 'nested', 'out.txt')
  writeAttachment(path, Buffer.from('x').toString('base64'))
  assert.equal(readFileSync(path, 'utf8'), 'x')
})

test('writeAttachment tolerates surrounding whitespace in the payload', () => {
  const dir = scratch()
  const path = join(dir, 'ws.txt')
  writeAttachment(path, `\n${Buffer.from('trimmed').toString('base64')}\n`)
  assert.equal(readFileSync(path, 'utf8'), 'trimmed')
})

test('writeAttachment handles empty content', () => {
  const dir = scratch()
  const path = join(dir, 'empty.txt')
  assert.equal(writeAttachment(path, '').bytes, 0)
  assert.equal(writeAttachment(path, undefined).bytes, 0)
})

test('writeAttachment explains a failed write', () => {
  const dir = scratch()
  mkdirSync(join(dir, 'blocked'), { recursive: true })
  assert.throws(
    () => writeAttachment(join(dir, 'blocked'), Buffer.from('x').toString('base64')),
    UserError,
  )
})
