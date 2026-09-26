// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// Once resolved, an elicitation's metadata.content holds the answer keyed by
// schema property name — look up that property's own title for a label.
export function elicitAnswerLabel(m, key) {
  return m.metadata?.requestedSchema?.properties?.[key]?.title || key;
}

export function formatElicitAnswerValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(none)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === undefined || value === null || value === '') return '(empty)';
  return String(value);
}

// One line for the collapsed card: the bare value when there is one field,
// "Label: value" pairs otherwise. Empty when there is nothing to show.
export function elicitAnswerSummary(m) {
  const entries = Object.entries(m.metadata?.content || {});
  if (entries.length === 1) return formatElicitAnswerValue(entries[0][1]);
  return entries
    .map(([key, value]) => `${elicitAnswerLabel(m, key)}: ${formatElicitAnswerValue(value)}`)
    .join(' · ');
}
