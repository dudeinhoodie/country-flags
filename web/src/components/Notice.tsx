import type { ReactNode } from "react";

/**
 * The card a page shows when it has nothing else to show: a missing
 * document, a failed read. One title, one line of explanation, one thing to
 * do about it.
 */
export function Notice({
  title,
  body,
  action,
  role = "status",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <section className="glass notice" role={role}>
      <h2 className="notice-title">{title}</h2>
      <p className="notice-body">{body}</p>
      {action !== undefined && <div className="notice-actions">{action}</div>}
    </section>
  );
}
