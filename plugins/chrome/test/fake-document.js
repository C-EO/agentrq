// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// Just enough of a page for the popup and options scripts: elements by id,
// with their properties and click/submit listeners.

function element() {
  return {
    value: '',
    textContent: '',
    className: '',
    title: '',
    src: '',
    hidden: true,
    events: {},
    addEventListener(type, fn) {
      this.events[type] = fn
    },
  }
}

export function fakeDocument(ids) {
  const elements = Object.fromEntries(ids.map((id) => [id, element()]))
  return { elements, getElementById: (id) => elements[id] }
}
