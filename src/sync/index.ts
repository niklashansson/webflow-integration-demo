import type { Category, City, Studio } from "../db/index.js";
import type { SyncResult } from "../types.js";
import { syncCategoriesToWebflow } from "./categories.js";
import { syncCitiesToWebflow } from "./cities.js";
import { syncStudiosToWebflow } from "./studios.js";
import { cleanupAll } from "./cleanup.js";

/**
 * Aggregate result of a full sync pipeline run.
 */
export type SyncAllResult = {
  categories: SyncResult;
  cities: SyncResult;
  studios: SyncResult;
  cleanup: Awaited<ReturnType<typeof cleanupAll>>;
  totalDuration: number;
};

/**
 * Run the full sync pipeline in dependency order.
 *
 * Order of operations:
 *  1. Categories & Cities in parallel (independent of each other)
 *  2. Studios (depends on categories + cities for reference resolution)
 *  3. Cleanup orphaned items (handles reference removal automatically)
 *
 * Accepts the source data as parameters so the caller decides
 * what data to sync (real or mutated for testing).
 */
export async function syncAll(
  categories: Category[],
  cities: City[],
  studios: Studio[],
): Promise<SyncAllResult> {
  const startTime = Date.now();

  console.log("🚀 Sync all: starting full pipeline");

  // Step 1: Sync categories & cities in parallel (no dependency between them)
  const [categoryResults, cityResults] = await Promise.all([
    syncCategoriesToWebflow(categories),
    syncCitiesToWebflow(cities),
  ]);

  // Step 2: Sync studios (needs categories + cities synced for reference IDs)
  const studioResults = await syncStudiosToWebflow(studios);

  // Step 3: Cleanup orphaned items using the source data's IDs
  const cleanupResults = await cleanupAll(
    new Set(categories.map((c) => c.id)),
    new Set(cities.map((c) => c.id)),
    new Set(studios.map((s) => s.id)),
  );

  const totalDuration = Date.now() - startTime;

  console.log(`✅ Sync all: pipeline complete in ${totalDuration}ms`);

  return {
    categories: categoryResults,
    cities: cityResults,
    studios: studioResults,
    cleanup: cleanupResults,
    totalDuration,
  };
}
