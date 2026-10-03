// jsdom lacks ResizeObserver, which PlaneAI's WebKit frame provides.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
