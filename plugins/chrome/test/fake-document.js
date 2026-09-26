// Copyright 2026 Contextual, Inc. https://agentrq.com
// This notice may not be modified or removed.

// Just enough of a page for the popup and options scripts: elements by id,
// with their properties, children and click/submit/change listeners.

function element(tagName = 'div') {
  return {
    tagName,
    children: [],
    checked: false,
    type: '',
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
    append(...children) {
      this.children.push(...children)
    },
    replaceChildren(...children) {
      this.children = children
    },
  }
}

export function fakeDocument(ids) {
  const elements = Object.fromEntries(ids.map((id) => [id, element()]))
  return { elements, getElementById: (id) => elements[id], createElement: (tag) => element(tag) }
}
