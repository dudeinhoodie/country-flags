/** Glass rows with nothing in them yet, in the shape of what is coming. */
export function SkeletonRows({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  return (
    <div className="glass list" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="row row--skeleton" aria-hidden>
          <span
            className="skeleton-line"
            style={{ width: `${String(52 - index * 12)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

/** The same wait, in the shape of a document. */
export function SkeletonProse({ label }: { label: string }) {
  return (
    <div className="glass prose" role="status" aria-label={label}>
      <div className="prose-skeleton" aria-hidden>
        <span className="skeleton-line" style={{ width: "92%" }} />
        <span className="skeleton-line" style={{ width: "84%" }} />
        <span className="skeleton-line" style={{ width: "70%" }} />
        <span className="skeleton-line skeleton-line--gap" />
        <span className="skeleton-line" style={{ width: "46%" }} />
        <span className="skeleton-line" style={{ width: "88%" }} />
        <span className="skeleton-line" style={{ width: "76%" }} />
      </div>
    </div>
  );
}
