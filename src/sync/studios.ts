import {
  webflowConfig,
  webflow,
  schedule,
  resolveCollections,
} from "../webflow/client.js";
import { type Studio } from "../db/index.js";
import { syncCollection, getIdMap } from "../utils/sync.js";
import { getLocaleFromWebflowTag } from "../utils/locales.js";
import { getStudiosSchema } from "../webflow/schemas.js";

/**
 * Sync all studios to Webflow CMS with all locales.
 *
 * Resolves collection IDs, field slugs, and reference ID mappings
 * from the cached collection resolver.
 */
export async function syncStudiosToWebflow(studios: Studio[]) {
  const cols = await resolveCollections();
  const s = (desired: string) => cols.studios.slugMap.get(desired) ?? desired;

  // Resolve reference IDs: local ID → Webflow item ID
  const [categoryIdMap, cityIdMap] = await Promise.all([
    getIdMap(
      cols.categories.id,
      webflow,
      webflowConfig.siteId,
      cols.categories.slugMap.get("external-id") ?? "external-id",
      schedule,
    ),
    getIdMap(
      cols.cities.id,
      webflow,
      webflowConfig.siteId,
      cols.cities.slugMap.get("external-id") ?? "external-id",
      schedule,
    ),
  ]);

  return syncCollection(
    {
      collectionId: cols.studios.id,
      entityName: "Studios",
      siteId: webflowConfig.siteId,
      items: studios,
      identifierField: s("external-id"),
      schema: getStudiosSchema(cols.categories.id, cols.cities.id),
      buildFieldData: (studio, webflowLocaleTag) => {
        // Resolve city reference with warning if not found
        const cityWebflowId = cityIdMap.get(studio.city);
        if (!cityWebflowId && studio.city) {
          console.warn(
            `   ⚠️ City "${studio.city}" not found in Webflow for studio "${studio.id}"`,
          );
        }

        // Resolve category references with warnings for any not found
        const categoryWebflowIds: string[] = [];
        for (const categoryId of studio.categoryIds) {
          const webflowId = categoryIdMap.get(categoryId);
          if (webflowId) {
            categoryWebflowIds.push(webflowId);
          } else {
            console.warn(
              `   ⚠️ Category "${categoryId}" not found in Webflow for studio "${studio.id}"`,
            );
          }
        }

        const locale = getLocaleFromWebflowTag(webflowLocaleTag);

        // Use resolved slugs for field keys (e.g. "latitude-2" instead of "latitude")
        return {
          name: studio.translations[locale].name,
          slug: studio.slug,
          [s("external-id")]: studio.id,
          [s("hero-image")]: studio.heroImageUrl ?? undefined,
          [s("address")]: studio.address,
          [s("latitude")]: studio.lat ?? undefined,
          [s("longitude")]: studio.lng ?? undefined,
          [s("city")]: cityWebflowId ?? undefined,
          [s("categories")]: categoryWebflowIds,
          [s("description")]: studio.translations[locale].description,
        };
      },
    },
    webflow,
    schedule,
  );
}
