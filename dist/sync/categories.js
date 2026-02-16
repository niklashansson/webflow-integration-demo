import { webflowConfig } from "../webflow/client.js";
import {} from "../db/index.js";
import { syncCollection, getIdMap } from "./utils.js";
/**
 * Build category field data for a specific locale.
 */
function buildCategoryFieldData(category, locale) {
    return {
        name: category.locales[locale].name,
        slug: category.slug,
        "external-id": category.id,
    };
}
/**
 * Sync all categories to Webflow CMS with all locales.
 */
export async function syncAllCategories(dbCategories) {
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
export async function getCategoryIdMap() {
    return getIdMap(webflowConfig.collectionSlugs.categories);
}
