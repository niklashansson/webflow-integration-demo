import { webflowConfig } from "../webflow/client.js";
import {} from "../db/index.js";
import { syncCollection, getIdMap } from "./utils.js";
/**
 * Build city field data for a specific locale.
 */
function buildCityFieldData(city, locale) {
    return {
        name: city.locales[locale].name,
        slug: city.slug,
        "external-id": city.id,
    };
}
/**
 * Sync all cities to Webflow CMS with all locales.
 */
export async function syncAllCities(dbCities) {
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
export async function getCityIdMap() {
    return getIdMap(webflowConfig.collectionSlugs.cities);
}
