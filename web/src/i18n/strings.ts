import { uiLanguageOf } from "./language";
import type { UiLanguage } from "./language";

/**
 * The page's own words, in the two languages the app ships. The documents
 * themselves arrive already localised; this is only the chrome around them.
 */
export interface Strings {
  readonly brand: string;
  readonly tagline: string;
  readonly lead: string;
  readonly documents: string;
  readonly nothingPublished: string;
  readonly support: string;
  readonly supportText: string;
  /** Around the linked names, so the link is the name and nothing is said twice. */
  readonly attributionFlags: readonly [before: string, after: string];
  readonly attributionOutlines: readonly [before: string, after: string];
  readonly devStand: string;
  readonly legalLabel: string;
  readonly lastUpdated: (date: string) => string;
  readonly backHome: string;
  readonly alsoPublished: string;
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly errorTitle: string;
  readonly errorBody: string;
  readonly retry: string;
  readonly home: string;
  readonly loading: string;
  readonly startupFailedTitle: string;
}

const EN: Strings = {
  brand: "Vexi",
  tagline: "Learn the flags of the world, one card at a time.",
  lead: "A free iOS app that shows you a flag, asks whether you knew it, and decides when to ask again. No advertising, and everything works without an account. A few decks are an optional one-time purchase.",
  documents: "Documents",
  nothingPublished: "Nothing is published yet.",
  support: "Support",
  supportText: "Questions, bug reports and anything else",
  attributionFlags: ["Flag artwork from ", " (MIT)."],
  attributionOutlines: ["Country outlines from ", " (public domain)."],
  devStand: "dev stand",
  legalLabel: "Legal",
  lastUpdated: (date) => `Last updated ${date}`,
  backHome: "Vexi",
  alsoPublished: "Also published",
  notFoundTitle: "There is no such document",
  notFoundBody: "Check the address, or start from the home page.",
  errorTitle: "The page could not be loaded",
  errorBody: "Check the connection and try again.",
  retry: "Try again",
  home: "Home",
  loading: "Loading…",
  startupFailedTitle: "The site cannot start",
};

const RU: Strings = {
  brand: "Vexi",
  tagline: "Флаги мира, по одной карточке за раз.",
  lead: "Бесплатное приложение для iOS: показывает флаг, спрашивает, знали ли вы его, и решает, когда спросить снова. Без рекламы, всё работает без учётной записи. Несколько колод продаются отдельно разовой покупкой.",
  documents: "Документы",
  nothingPublished: "Пока ничего не опубликовано.",
  support: "Поддержка",
  supportText: "Вопросы, сообщения об ошибках и всё остальное",
  attributionFlags: ["Изображения флагов — ", " (MIT)."],
  attributionOutlines: ["Контуры стран — ", " (общественное достояние)."],
  devStand: "dev-стенд",
  legalLabel: "Документ",
  lastUpdated: (date) => `Обновлено ${date}`,
  backHome: "Vexi",
  alsoPublished: "Также опубликовано",
  notFoundTitle: "Такого документа нет",
  notFoundBody: "Проверьте адрес или начните с главной.",
  errorTitle: "Не удалось загрузить страницу",
  errorBody: "Проверьте соединение и попробуйте снова.",
  retry: "Повторить",
  home: "На главную",
  loading: "Загрузка…",
  startupFailedTitle: "Сайт не может запуститься",
};

const STRINGS: Record<UiLanguage, Strings> = { en: EN, ru: RU };

export function stringsFor(language: string): Strings {
  return STRINGS[uiLanguageOf(language)];
}

/**
 * A publication date the way the reader's language writes one. UTC on
 * purpose: the date is the document's, not the reader's afternoon.
 */
export function formatDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(uiLanguageOf(language), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
