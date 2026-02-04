import { webflow, config, findCollectionBySlug } from "../webflow/client.js";
import { getAllCategories, getAllCities, getAllStudios } from "../db/index.js";
import { syncAllCategories } from "./categories.js";
import { syncAllCities } from "./cities.js";
import { syncAllStudios } from "./studios.js";
import { cleanupAllCollections } from "./cleanup.js";

// Build mapping from external IDs to Webflow Item IDs (only for items in DB)
async function buildCategoryIdMap(validDbIds: Set<string>) {
  const collection = await findCollectionBySlug(config.siteId, "categories");
  if (!collection) throw new Error("Categories collection not found");

  const items = await webflow.collections.items.listItems(collection.id);
  const map = new Map<string, string>();

  for (const item of items.items ?? []) {
    const externalId = (item.fieldData as any)?.["external-id"];
    if (externalId && item.id && validDbIds.has(externalId)) {
      map.set(externalId, item.id);
    }
  }
  return map;
}

// Build mapping from city names to Webflow Item IDs
async function buildCityIdMap() {
  const collection = await findCollectionBySlug(config.siteId, "cities");
  if (!collection) throw new Error("Cities collection not found");

  const items = await webflow.collections.items.listItems(collection.id);
  const map = new Map<string, string>();

  for (const item of items.items ?? []) {
    const cityName = (item.fieldData as any)?.name;
    if (cityName && item.id) {
      map.set(cityName, item.id);
    }
  }
  return map;
}

/**
 * Full sync orchestration:
 * 1. Sync categories → 2. Sync cities → 3. Build mappings → 4. Sync studios → 5. Cleanup
 */
export async function syncAll() {
  console.log("🚀 Starting full sync...\n");

  const categories = getAllCategories();
  const cities = getAllCities();
  const studios = getAllStudios();

  // Step 1: Categories
  console.log("📁 Step 1: Syncing categories...");
  const categoryResults = await syncAllCategories(categories);
  console.log(
    `   ✅ Created: ${categoryResults.created}, Updated: ${categoryResults.updated}\n`,
  );

  // Step 2: Cities
  console.log("🏙️ Step 2: Syncing cities...");
  const cityResults = await syncAllCities(cities);
  console.log(
    `   ✅ Created: ${cityResults.created}, Updated: ${cityResults.updated}\n`,
  );

  // Step 3: Build ID mappings
  console.log("🔗 Step 3: Building ID mappings...");
  const categoryIdMap = await buildCategoryIdMap(
    new Set(categories.map((c) => c.id)),
  );
  const cityIdMap = await buildCityIdMap();
  console.log(
    `   ✅ Mapped ${categoryIdMap.size} categories, ${cityIdMap.size} cities\n`,
  );

  // Step 4: Studios
  console.log("🏢 Step 4: Syncing studios...");
  const studioResults = await syncAllStudios(
    config.siteId,
    studios,
    categoryIdMap,
    cityIdMap,
  );
  console.log(
    `   ✅ Created: ${studioResults.created}, Updated: ${studioResults.updated}\n`,
  );

  // Step 5: Cleanup
  console.log("🧹 Step 5: Cleaning up orphaned items...");
  const cleanupResults = await cleanupAllCollections(
    new Set(categories.map((c) => c.id)),
    new Set(cities.map((c) => c.id)),
    new Set(studios.map((s) => s.id)),
  );

  const totalDeleted =
    cleanupResults.categories.deleted +
    cleanupResults.cities.deleted +
    cleanupResults.studios.deleted;
  console.log(
    totalDeleted > 0
      ? `   ✅ Deleted ${totalDeleted} orphaned item(s)\n`
      : `   ✅ No orphaned items\n`,
  );

  console.log("🎉 Full sync complete!");
  return {
    categories: categoryResults,
    cities: cityResults,
    studios: studioResults,
    cleanup: cleanupResults,
  };
}
