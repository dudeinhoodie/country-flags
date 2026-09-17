import { Link } from "react-router-dom";
import { FlagFan } from "../components/FlagFan";
import { Notice } from "../components/Notice";
import { SiteFooter } from "../components/SiteFooter";
import { SkeletonRows } from "../components/Skeleton";
import { Wordmark } from "../components/Wordmark";
import { documentsFor } from "../documents/documents";
import { useDocumentIndex } from "../documents/useDocuments";
import { stringsFor } from "../i18n/strings";
import { useLanguage, usePageMeta } from "../i18n/useLanguage";

export const SUPPORT_EMAIL = "slmyskov@gmail.com";

/**
 * The front door: what the app is, and the documents it publishes. The
 * list is whatever the snapshot says is published, in the reader's language
 * where it exists — a document that is only in English is still listed,
 * because a reader is better served by the English edition than by a gap.
 */
export function HomePage() {
  const { language, href } = useLanguage();
  const strings = stringsFor(language);
  const { index, reload } = useDocumentIndex();
  usePageMeta(language, strings.brand);

  return (
    <main className="page">
      <header className="hero">
        <Wordmark label={strings.brand} />
        <FlagFan />
        <h1 className="tagline">{strings.tagline}</h1>
        <p className="lead">{strings.lead}</p>
      </header>

      <section className="section" aria-labelledby="documents-heading">
        <h2 className="label" id="documents-heading">
          {strings.documents}
        </h2>
        {index.status === "loading" && (
          <SkeletonRows count={2} label={strings.loading} />
        )}
        {index.status === "failed" && (
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
        {index.status === "ready" &&
          (() => {
            const documents = documentsFor(index.value, language);
            if (documents.length === 0) {
              return (
                <div className="glass list">
                  <p className="row row--text">{strings.nothingPublished}</p>
                </div>
              );
            }
            return (
              <nav className="glass list" aria-label={strings.documents}>
                {documents.map((entry) => (
                  <Link
                    key={entry.slug}
                    className="row"
                    to={href(`/${entry.slug}`)}
                    lang={entry.locale}
                  >
                    <span>{entry.title}</span>
                    <span className="chevron" aria-hidden>
                      ›
                    </span>
                  </Link>
                ))}
              </nav>
            );
          })()}
      </section>

      <section className="section" aria-labelledby="support-heading">
        <h2 className="label" id="support-heading">
          {strings.support}
        </h2>
        <div className="glass list">
          <a className="row" href={`mailto:${SUPPORT_EMAIL}`}>
            <span className="row-stack">
              <span className="row-caption">{strings.supportText}</span>
              <span>{SUPPORT_EMAIL}</span>
            </span>
            <span className="chevron" aria-hidden>
              ›
            </span>
          </a>
        </div>
      </section>

      <SiteFooter strings={strings} />
    </main>
  );
}
