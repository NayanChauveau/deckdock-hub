import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
for (const key of [
  'window',
  'self',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLInputElement',
  'HTMLFormElement',
  'HTMLButtonElement',
  'HTMLSelectElement',
  'Element',
  'Node',
  'DocumentFragment',
  'MutationObserver',
  'CustomEvent',
  'File',
  'FormData',
  'Event',
  'MouseEvent',
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: dom.window[key as keyof typeof dom.window],
  })
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// jsdom has no layout engine; Radix still needs the scrolling API when moving focus.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value() {
    /* Geometry is covered by future browser tests. */
  },
})
Object.defineProperty(globalThis, 'getComputedStyle', {
  configurable: true,
  value: dom.window.getComputedStyle.bind(dom.window),
})
Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: dom.window.requestAnimationFrame.bind(dom.window),
})
Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  value: dom.window.cancelAnimationFrame.bind(dom.window),
})
// Radix measures controls such as Checkbox; jsdom has no ResizeObserver and no geometry to report.
class NoLayoutResizeObserver {
  observe() {
    /* No layout in jsdom. */
  }
  unobserve() {
    /* No layout in jsdom. */
  }
  disconnect() {
    /* No layout in jsdom. */
  }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: NoLayoutResizeObserver,
})

// jsdom cannot decode images; model blob URLs for local file-preview lifecycle tests.
let objectURLSequence = 0
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: (_file: Blob) => `blob:http://localhost/photo-${++objectURLSequence}`,
})
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: (_url: string) => {
    /* No native blob registry in jsdom. */
  },
})
