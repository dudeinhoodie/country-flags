import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { LANGUAGE_PARAM, normalizeLanguage, withLanguage } from "./language";

/** The reader's language, and a way to keep it on every link. */
export function useLanguage(): {
  language: string;
  rawLanguage: string | null;
  href: (path: string) => string;
} {
  const [params] = useSearchParams();
  const rawLanguage = params.get(LANGUAGE_PARAM);
  const language = normalizeLanguage(rawLanguage);
  const href = useCallback(
    (path: string) => withLanguage(path, rawLanguage),
    [rawLanguage],
  );
  return { language, rawLanguage, href };
}

/**
 * What the browser tab and assistive technology are told: the language the
 * page is actually shown in — which, after a fallback, may not be the one
 * that was asked for — and a title that names the document.
 */
export function usePageMeta(language: string, title: string): void {
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = title;
  }, [language, title]);
}
