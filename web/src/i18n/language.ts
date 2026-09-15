/**
 * The language a page is read in.
 *
 * It comes from one place: the `lang` query parameter the iOS app appends
 * when it opens a document (`?lang=ru`). There is no switcher on the page
 * and no reading of the browser's own preference — the app decides, so that
 * what the reader tapped in Russian opens in Russian, and the default for
 * everybody else is English.
 */

export const DEFAULT_LANGUAGE = "en";

export const UI_LANGUAGES = ["en", "ru"] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const LANGUAGE_PARAM = "lang";

/**
 * The base language of whatever was passed: `ru-RU`, `ru_RU` and `RU` all
 * mean `ru`. Anything that is not a language tag at all means the default.
 */
export function normalizeLanguage(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) {
    return DEFAULT_LANGUAGE;
  }
  const base = raw.trim().split(/[-_]/, 1)[0] ?? "";
  const lower = base.toLowerCase();
  return /^[a-z]{2,3}$/.test(lower) ? lower : DEFAULT_LANGUAGE;
}

/** The dictionary the page's own words come from; documents may be in more. */
export function uiLanguageOf(language: string): UiLanguage {
  return (UI_LANGUAGES as readonly string[]).includes(language)
    ? (language as UiLanguage)
    : "en";
}

/**
 * The same address, still carrying the reader's language. The parameter is
 * forwarded as it arrived rather than normalised: the app put it there, and
 * a link that rewrote it would be a second opinion.
 */
export function withLanguage(path: string, rawLanguage: string | null): string {
  if (rawLanguage === null || rawLanguage.trim() === "") {
    return path;
  }
  return `${path}?${LANGUAGE_PARAM}=${encodeURIComponent(rawLanguage)}`;
}
