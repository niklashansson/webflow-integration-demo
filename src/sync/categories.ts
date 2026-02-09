import { webflowConfig } from "../webflow/client.js";
import { type Category, type SupportedLocale } from "../db/index.js";
import { syncCollection, getIdMap, type SyncResult } from "./utils.js";

/**
 * Build category field data for a specific locale.
 */
function buildCategoryFieldData(category: Category, locale: SupportedLocale) {
  return {
    name: category.locales[locale].name,
    slug: category.slug,
    "external-id": category.id,
  };
}

/**
 * Sync all categories to Webflow CMS with all locales.
 */
export async function syncAllCategories(
  dbCategories: Category[],
): Promise<SyncResult> {
  return syncCollection({
    collectionSlug: webflowConfig.collectionSlugs.categories,
    entityName: "Categories",
    items: dbCategories,
    buildFieldData: buildCategoryFieldData,
  });
}

/**
 * Build a mapping from database external IDs to Webflow item IDs.
 */
export async function getCategoryIdMap(): Promise<Map<string, string>> {
  return getIdMap(webflowConfig.collectionSlugs.categories);
}
