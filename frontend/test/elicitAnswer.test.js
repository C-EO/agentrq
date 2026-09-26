// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

import { describe, it, expect } from 'vitest';

import { elicitAnswerLabel, formatElicitAnswerValue, elicitAnswerSummary } from '../src/composables/useElicitAnswer';

const msg = (content, properties) => ({ metadata: { content, requestedSchema: properties && { properties } } });

describe('elicitAnswerLabel', () => {
  it('uses the property title, falling back to its name', () => {
    const m = msg({}, { transport: { title: 'Transport' } });
    expect(elicitAnswerLabel(m, 'transport')).toBe('Transport');
    expect(elicitAnswerLabel(m, 'other')).toBe('other');
    expect(elicitAnswerLabel({}, 'x')).toBe('x');
  });
});

describe('formatElicitAnswerValue', () => {
  it('formats each kind of value', () => {
    expect(formatElicitAnswerValue(['a', 'b'])).toBe('a, b');
    expect(formatElicitAnswerValue([])).toBe('(none)');
    expect(formatElicitAnswerValue(true)).toBe('Yes');
    expect(formatElicitAnswerValue(false)).toBe('No');
    expect(formatElicitAnswerValue('')).toBe('(empty)');
    expect(formatElicitAnswerValue(null)).toBe('(empty)');
    expect(formatElicitAnswerValue(undefined)).toBe('(empty)');
    expect(formatElicitAnswerValue(3)).toBe('3');
  });
});

describe('elicitAnswerSummary', () => {
  it('shows a single answer bare', () => {
    expect(elicitAnswerSummary(msg({ transport: 'stdio' }, { transport: { title: 'Transport' } }))).toBe('stdio');
  });

  it('labels several answers', () => {
    const m = msg({ transport: 'http', retry: true }, { transport: { title: 'Transport' } });
    expect(elicitAnswerSummary(m)).toBe('Transport: http · retry: Yes');
  });

  it('is empty with no content', () => {
    expect(elicitAnswerSummary({ metadata: {} })).toBe('');
    expect(elicitAnswerSummary({})).toBe('');
  });
});
