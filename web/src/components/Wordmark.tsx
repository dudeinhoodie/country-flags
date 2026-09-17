import { Link } from "react-router-dom";

/** The app mark: a cobalt tile with a flag, and the name beside it. */
export function BrandMark({ size = 28 }: { size?: number }) {
  const radius = Math.round(size * 0.28);
  return (
    <span
      aria-hidden
      className="mark"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <svg
        width={Math.round(size * 0.58)}
        height={Math.round(size * 0.58)}
        viewBox="0 0 24 24"
        fill="currentColor"
        focusable="false"
      >
        <path d="M6 3a1 1 0 0 1 1 1v.3l1.2-.4c1.9-.6 3.9-.3 5.6.5 1.4.7 3 .9 4.5.4l1.4-.5a1 1 0 0 1 1.3.9V13a1 1 0 0 1-.7 1l-1.4.4c-2 .6-4.1.4-6-.5-1.4-.7-3-.9-4.5-.4L7 14v6a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Z" />
      </svg>
    </span>
  );
}

export function Wordmark({ to, label }: { to?: string; label: string }) {
  const content = (
    <>
      <BrandMark />
      <span>{label}</span>
    </>
  );
  if (to === undefined) {
    return <p className="wordmark">{content}</p>;
  }
  return (
    <Link className="wordmark wordmark--link" to={to}>
      {content}
    </Link>
  );
}
