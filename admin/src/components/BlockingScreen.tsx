import type { CSSProperties } from "react";

const screenStyle: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#1a1a1a",
  color: "#f5f5f5",
  fontFamily: "system-ui, sans-serif",
  padding: "2rem",
};

const panelStyle: CSSProperties = {
  maxWidth: "36rem",
  borderLeft: "4px solid #d32f2f",
  paddingLeft: "1.5rem",
};

/**
 * Deliberately free of MUI and react-admin: it renders when the app must not
 * start (broken runtime config) or when the component tree above it crashed,
 * so it cannot rely on providers being intact.
 */
export function BlockingScreen({
  title,
  message,
  problems = [],
  hint,
}: {
  title: string;
  message: string;
  problems?: readonly string[];
  hint?: string;
}) {
  return (
    <div style={screenStyle} role="alert">
      <div style={panelStyle}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>{title}</h1>
        <p>{message}</p>
        {problems.length > 0 && (
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {hint !== undefined && <p style={{ opacity: 0.8 }}>{hint}</p>}
      </div>
    </div>
  );
}
