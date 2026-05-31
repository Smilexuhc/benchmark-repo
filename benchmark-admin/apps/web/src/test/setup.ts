import '@testing-library/jest-dom/vitest';

// jsdom does not implement scrollTo; TanStack Router invokes it on every route change.
if (typeof window !== 'undefined' && typeof window.scrollTo !== 'function') {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}
