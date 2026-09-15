import { Link, useParams } from "react-router-dom";
import { Notice } from "../components/Notice";
import { SiteFooter } from "../components/SiteFooter";
import { SkeletonProse } from "../components/Skeleton";
import { documentsFor } from "../documents/documents";
import { useDocument } from "../documents/useDocuments";
import { formatDate, stringsFor } from "../i18n/strings";
import { useLanguage, usePageMeta } from "../i18n/useLanguage";

/**
 * One published document. The chrome follows the language the document is
 * actually shown in: a Russian reader served the English edition (because
 * no Russian one is published) gets an English caption over it, not a
 * Russian caption over English prose.
 */
export function DocumentPage() {
  const { slug = "" } = useParams();
  const { language, href } = useLanguage();
  const { document: loaded, index, reload } = useDocument(slug, language);

  const shownLanguage =
    loaded.status === "ready" ? loaded.value.locale : language;
  const strings = stringsFor(shownLanguage);
  usePageMeta(
    shownLanguage,
    loaded.status === "ready"
      ? `${strings.brand} — ${loaded.value.title}`
      : strings.brand,
  );

  const others =
    index === null
      ? []
      : documentsFor(index, shownLanguage).filter(
          (entry) => entry.slug !== slug,
        );

  return (
    <main className="page page--document">
      <nav className="topbar" aria-label={strings.home}>
        <Link className="capsule capsule--back" to={href("/")}>
          <span aria-hidden>←</span>
          <span>{strings.backHome}</span>
        </Link>
      </nav>

      {loaded.status === "loading" && (
        <>
          <header className="doc-head">
            <p className="label">{strings.legalLabel}</p>
            <h1 className="title title--skeleton" aria-hidden>
              <span className="skeleton-line" style={{ width: "60%" }} />
            </h1>
          </header>
          <SkeletonProse label={strings.loading} />
        </>
      )}

      {loaded.status === "missing" && (
        <Notice
          title={strings.notFoundTitle}
          body={strings.notFoundBody}
          action={
            <Link className="capsule" to={href("/")}>
              {strings.home}
            </Link>
          }
        />
      )}

      {loaded.status === "failed" && (
        <Notice
          role="alert"
          title={strings.errorTitle}
          body={strings.errorBody}
          action={
            <button type="button" className="capsule" onClick={reload}>
              {strings.retry}
            </button>
          }
        />
      )}

      {loaded.status === "ready" && (
        <>
          <header className="doc-head">
            <p className="label">{strings.legalLabel}</p>
            <h1 className="title">{loaded.value.title}</h1>
            <p className="caption">
              <time dateTime={loaded.value.publishedAt}>
                {strings.lastUpdated(
                  formatDate(loaded.value.publishedAt, shownLanguage),
                )}
              </time>
            </p>
          </header>
          {/* The html is rendered by the backend from Markdown with raw
              HTML disabled, and only a signed-in publisher can write it:
              this is the product's own text, not user content. */}
          <article
            className="glass prose"
            lang={loaded.value.locale}
            dangerouslySetInnerHTML={{ __html: loaded.value.html }}
          />
        </>
      )}

      {others.length > 0 && (
        <nav className="also" aria-label={strings.alsoPublished}>
          <p className="label">{strings.alsoPublished}</p>
          <div className="also-links">
            {others.map((entry) => (
              <Link
                key={entry.slug}
                className="capsule"
                to={href(`/${entry.slug}`)}
                lang={entry.locale}
              >
                {entry.title}
              </Link>
            ))}
          </div>
        </nav>
      )}

      <SiteFooter strings={strings} />
    </main>
  );
}
