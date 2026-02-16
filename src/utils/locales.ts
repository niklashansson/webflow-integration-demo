import { PRIMARY_LOCALE, type SupportedLocale } from "../db/index.js";

/**
 * Map Webflow locale tag (e.g. "sv-SE") to our locale key (e.g. "sv")
 */
export const LOCALE_TAG_MAPPING: Record<string, SupportedLocale> = {
  "sv-SE": "sv",
  sv: "sv",
  "en-US": "en",
  "en-GB": "en",
  en: "en",
};

/**
 * Get locale from Webflow locale tag, fallback to primary locale if not found
 */
export function getLocaleFromWebflowTag(tag: string): SupportedLocale {
  return LOCALE_TAG_MAPPING[tag] ?? PRIMARY_LOCALE;
}
