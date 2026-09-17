import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { RuntimeConfigProvider } from "./config/RuntimeConfigContext";
import {
  loadRuntimeConfig,
  RUNTIME_CONFIG_URL,
  RuntimeConfigError,
} from "./config/runtime-config";
import type { RuntimeConfig } from "./config/runtime-config";
import { DocumentPage } from "./pages/DocumentPage";
import { HomePage } from "./pages/HomePage";

/** Every address the site answers. Exported so the tests can mount it under a memory router. */
export function SiteRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/:slug" element={<DocumentPage />} />
      {/* Anything deeper is not a document; the page says so rather than
          rendering nothing. */}
      <Route path="*" element={<DocumentPage />} />
    </Routes>
  );
}

type BootstrapState =
  | { status: "loading" }
  | { status: "blocked"; error: unknown }
  | { status: "ready"; config: RuntimeConfig };

/**
 * Reads which deployment this is before rendering anything. The page could
 * draw the documents without knowing, but a site that cannot tell dev from
 * prod is exactly the kind of deployment the runtime config exists to
 * refuse (ADR-014's rule, borrowed).
 */
export function App() {
  const [state, setState] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadRuntimeConfig().then(
      (config) => {
        if (!cancelled) {
          setState({ status: "ready", config });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: "blocked", error });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <div className="scene" aria-hidden />;
  }
  if (state.status === "blocked") {
    const error = state.error;
    const problems = error instanceof RuntimeConfigError ? error.problems : [];
    return (
      <>
        <div className="scene" aria-hidden />
        <main className="page">
          <section className="glass notice" role="alert">
            <h1 className="notice-title">The site cannot start</h1>
            <p className="notice-body">
              {error instanceof Error
                ? error.message
                : `Loading ${RUNTIME_CONFIG_URL} failed`}
            </p>
            {problems.length > 0 && (
              <ul className="notice-body">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </section>
        </main>
      </>
    );
  }
  return (
    <RuntimeConfigProvider config={state.config}>
      <div className="scene" aria-hidden />
      <BrowserRouter>
        <SiteRoutes />
      </BrowserRouter>
    </RuntimeConfigProvider>
  );
}
