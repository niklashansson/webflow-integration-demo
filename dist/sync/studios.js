import { webflowConfig } from "../webflow/client.js";
import {} from "../db/index.js";
import { syncCollection } from "./utils.js";
/**
 * Build studio field data for a specific locale.
 * Logs warnings when referenced IDs are not found in Webflow.
 */
function buildStudioFieldData(studio, locale, deps) {
    // Resolve city reference with warning if not found
    const cityWebflowId = deps.cityIdMap.get(studio.city);
    if (!cityWebflowId && studio.city) {
        console.warn(`   ⚠️ City "${studio.city}" not found in Webflow for studio "${studio.id}"`);
    }
    // Resolve category references with warnings for any not found
    const categoryWebflowIds = [];
    for (const categoryId of studio.categoryIds) {
        const webflowId = deps.categoryIdMap.get(categoryId);
        if (webflowId) {
            categoryWebflowIds.push(webflowId);
        }
        else {
            console.warn(`   ⚠️ Category "${categoryId}" not found in Webflow for studio "${studio.id}"`);
        }
    }
    return {
        name: studio.locales[locale].name,
        slug: studio.slug,
        "external-id": studio.id,
        "hero-image": studio.heroImageUrl ?? undefined,
        address: studio.address,
        latitude: studio.lat ?? undefined,
        longitude: studio.lng ?? undefined,
        city: cityWebflowId ?? undefined,
        categories: categoryWebflowIds,
        description: studio.locales[locale].description,
    };
}
/**
 * Sync all studios to Webflow CMS with all locales.
 */
export async function syncAllStudios(dbStudios, categoryIdMap, cityIdMap) {
    const deps = { categoryIdMap, cityIdMap };
    return syncCollection({
        collectionSlug: webflowConfig.collectionSlugs.studios,
        entityName: "Studios",
        items: dbStudios,
        buildFieldData: (studio, locale) => buildStudioFieldData(studio, locale, deps),
    });
}
