import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollTo; TanStack Router invokes it on every route change.
if (typeof window !== 'undefined' && typeof window.scrollTo !== 'function') {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}

// jsdom doesn't ship ResizeObserver; AssetLibrary's responsive column count
// observes its scroll container's width. A no-op stub is enough for tests —
// they don't depend on real resize events.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom reports 0 for layout sizes on every element, which makes
// @tanstack/react-virtual render zero rows (its `getRect` reads
// `offsetWidth`/`offsetHeight` to size the scroll viewport). Pin reasonable
// defaults so virtualized lists actually mount their items under test. Real
// browsers compute these from layout — tests can't.
function defineLayoutSize(
  key: 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight',
  value: number,
) {
  Object.defineProperty(HTMLElement.prototype, key, {
    configurable: true,
    get() {
      return value;
    },
  });
}
defineLayoutSize('clientWidth', 1024);
defineLayoutSize('clientHeight', 1024);
defineLayoutSize('offsetWidth', 1024);
defineLayoutSize('offsetHeight', 1024);
