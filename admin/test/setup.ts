import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// jsdom does not implement matchMedia, which MUI's useMediaQuery relies on.
if (typeof window.matchMedia !== "function") {
  const matchMediaStub = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: matchMediaStub,
  });
}
