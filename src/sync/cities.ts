import { webflowConfig } from "../webflow/client.js";
import { type City, type SupportedLocale } from "../db/index.js";
import { syncCollection, getIdMap, type SyncResult } from "./utils.js";

/**
 * Build city field data for a specific locale.
 */
function buildCityFieldData(city: City, locale: SupportedLocale) {
  return {
    name: city.locales[locale].name,
    slug: city.slug,
    "external-id": city.id,
  };
}

/**
 * Sync all cities to Webflow CMS with all locales.
 */
export async function syncAllCities(dbCities: City[]): Promise<SyncResult> {
  return syncCollection({
    collectionSlug: webflowConfig.collectionSlugs.cities,
    entityName: "Cities",
    items: dbCities,
    buildFieldData: buildCityFieldData,
  });
}

/**
 * Build a mapping from database external IDs to Webflow item IDs.
 */
export async function getCityIdMap(): Promise<Map<string, string>> {
  return getIdMap(webflowConfig.collectionSlugs.cities);
}
