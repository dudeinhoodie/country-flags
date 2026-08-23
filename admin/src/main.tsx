import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Bootstrap } from "./app/Bootstrap";
import { ErrorBoundary } from "./components/ErrorBoundary";

const container = document.getElementById("root");
if (container === null) {
  throw new Error('index.html must contain a "root" element');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <Bootstrap />
    </ErrorBoundary>
  </StrictMode>,
);
