import {
  webflowConfig,
  webflow,
  schedule,
  resolveCollections,
} from "../webflow/client.js";
import { type City } from "../db/index.js";
import { syncCollection } from "../utils/sync.js";
import { getLocaleFromWebflowTag } from "../utils/locales.js";
import { citiesSchema } from "../webflow/schemas.js";

/**
 * Sync all cities to Webflow CMS with all locales.
 *
 * Collection ID and field slugs are resolved automatically
 * from the cached collection resolver.
 */
export async function syncCitiesToWebflow(cities: City[]) {
  const { cities: collection } = await resolveCollections();
  const s = (desired: string) => collection.slugMap.get(desired) ?? desired;

  return syncCollection(
    {
      collectionId: collection.id,
      entityName: "Cities",
      siteId: webflowConfig.siteId,
      items: cities,
      identifierField: s("external-id"),
      schema: citiesSchema,
      buildFieldData: (item, webflowLocaleTag) => {
        const locale = getLocaleFromWebflowTag(webflowLocaleTag);
        return {
          name: item.translations[locale].name,
          slug: item.slug,
          [s("external-id")]: item.id,
        };
      },
    },
    webflow,
    schedule,
  );
}
