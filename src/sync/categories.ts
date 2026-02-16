import {
  webflowConfig,
  webflow,
  schedule,
  resolveCollections,
} from "../webflow/client.js";
import { type Category } from "../db/index.js";
import { syncCollection } from "../utils/sync.js";
import { getLocaleFromWebflowTag } from "../utils/locales.js";
import { categoriesSchema } from "../webflow/schemas.js";

/**
 * Sync all categories to Webflow CMS with all locales.
 *
 * Collection ID and field slugs are resolved automatically
 * from the cached collection resolver.
 */
export async function syncCategoriesToWebflow(categories: Category[]) {
  const { categories: collection } = await resolveCollections();
  const s = (desired: string) => collection.slugMap.get(desired) ?? desired;

  return syncCollection(
    {
      collectionId: collection.id,
      entityName: "Categories",
      siteId: webflowConfig.siteId,
      items: categories,
      identifierField: s("external-id"),
      schema: categoriesSchema,
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
