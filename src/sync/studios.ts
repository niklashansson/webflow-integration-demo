import { webflowConfig } from "../webflow/client.js";
import { type Studio, type SupportedLocale } from "../db/index.js";
import { syncCollection, type SyncResult } from "./utils.js";
import type { StudioCollectionItem } from "../webflow/schemas.js";

// Extended options for studios (needs reference maps)
type StudioSyncDeps = {
  categoryIdMap: Map<string, string>;
  cityIdMap: Map<string, string>;
};

/**
 * Build studio field data for a specific locale.
 */
function buildStudioFieldData(
  studio: Studio,
  locale: SupportedLocale,
  deps: StudioSyncDeps,
): StudioCollectionItem {
  return {
    name: studio.locales[locale].name,
    slug: studio.slug,
    "external-id": studio.id,
    "hero-image": studio.heroImageUrl ?? undefined,
    address: studio.address,
    latitude: studio.lat ?? undefined,
    longitude: studio.lng ?? undefined,
    city: deps.cityIdMap.get(studio.city) ?? undefined,
    categories: studio.categoryIds
      .map((id) => deps.categoryIdMap.get(id) ?? undefined)
      .filter(Boolean) as string[],
    description: studio.locales[locale].description,
  };
}

/**
 * Sync all studios to Webflow CMS with all locales.
 */
export async function syncAllStudios(
  dbStudios: Studio[],
  categoryIdMap: Map<string, string>,
  cityIdMap: Map<string, string>,
): Promise<SyncResult> {
  const deps: StudioSyncDeps = { categoryIdMap, cityIdMap };

  return syncCollection({
    collectionSlug: webflowConfig.collectionSlugs.studios,
    entityName: "Studios",
    items: dbStudios,
    buildFieldData: (studio, locale) =>
      buildStudioFieldData(studio, locale, deps),
  });
}
