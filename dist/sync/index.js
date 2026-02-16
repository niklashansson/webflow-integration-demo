import { getAllCategories, getAllCities, getAllStudios } from "../db/index.js";
import { syncAllCategories, getCategoryIdMap } from "./categories.js";
import { syncAllCities, getCityIdMap } from "./cities.js";
import { syncAllStudios } from "./studios.js";
import { cleanupAll } from "./cleanup.js";
import { clearLocaleCache } from "../webflow/client.js";
/**
 * Sync all data from the database to Webflow CMS.
 *
 * Order of operations:
 * 1. Sync Categories (no dependencies)
 * 2. Sync Cities (no dependencies)
 * 3. Build ID mappings (for references)
 * 4. Sync Studios (depends on Categories and Cities)
 * 5. Cleanup orphaned items
 *
 * @returns Detailed results for each sync operation
 */
export async function syncAll() {
    const startTime = Date.now();
    // Clear locale cache at start to ensure fresh locale data
    clearLocaleCache();
    const categories = getAllCategories();
    const cities = getAllCities();
    const studios = getAllStudios();
    // Phase 1: Sync (order: Categories → Cities → Studios)
    const categoriesResult = await syncAllCategories(categories);
    const citiesResult = await syncAllCities(cities);
    const [categoryIdMap, cityIdMap] = await Promise.all([
        getCategoryIdMap(),
        getCityIdMap(),
    ]);
    const studiosResult = await syncAllStudios(studios, categoryIdMap, cityIdMap);
    // Phase 2: Cleanup (order: Studios → References → Cities/Categories)
    const cleanupResult = await cleanupAll(new Set(categories.map((c) => c.id)), new Set(cities.map((c) => c.id)), new Set(studios.map((s) => s.id)));
    const totalDuration = Date.now() - startTime;
    console.log(`\n🎉 Full sync complete in ${totalDuration}ms`);
    return {
        categories: categoriesResult,
        cities: citiesResult,
        studios: studiosResult,
        cleanup: cleanupResult,
        totalDuration,
    };
}
