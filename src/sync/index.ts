import { getAllCategories, getAllCities, getAllStudios } from "../db/index.js";
import { syncAllCategories, getCategoryIdMap } from "./categories.js";
import { syncAllCities, getCityIdMap } from "./cities.js";
import { syncAllStudios } from "./studios.js";
import { cleanupAll } from "./cleanup.js";

export async function syncAll() {
  const categories = getAllCategories();
  const cities = getAllCities();
  const studios = getAllStudios();

  // Phase 1: Sync (order: Categories → Cities → Studios)
  await syncAllCategories(categories);
  await syncAllCities(cities);
  const [categoryIdMap, cityIdMap] = await Promise.all([
    getCategoryIdMap(),
    getCityIdMap(),
  ]);
  await syncAllStudios(studios, categoryIdMap, cityIdMap);

  // Phase 2: Cleanup (order: Studios → References → Cities/Categories)
  await cleanupAll(
    new Set(categories.map((c) => c.id)),
    new Set(cities.map((c) => c.id)),
    new Set(studios.map((s) => s.id)),
  );
}
