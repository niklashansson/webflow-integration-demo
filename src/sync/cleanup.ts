import type { CleanupResult } from "../types.js";
import {
  cleanupDeletedItems,
  getOrphanedItems,
  removeReferencesToItems,
} from "../utils/cleanup.js";
import {
  webflow,
  webflowConfig,
  schedule,
  resolveCollections,
} from "../webflow/client.js";

type CleanupAllResult = {
  categories: CleanupResult;
  cities: CleanupResult;
  studios: CleanupResult;
};

function emptyCleanupResult(): CleanupResult {
  return {
    deleted: 0,
    deletedIdentifiers: [],
    deletedWebflowIds: [],
    errors: [],
  };
}

/**
 * Cleanup all collections with proper reference handling.
 *
 * Uses the cached collection resolver for IDs and slug maps.
 *
 * Order of operations:
 * 1. Delete Studios (no items reference Studios)
 * 2. Remove references to Cities/Categories from remaining Studios
 * 3. Delete Cities
 * 4. Delete Categories
 */
export async function cleanupAll(
  categoryIds: Set<string>,
  cityIds: Set<string>,
  studioIds: Set<string>,
): Promise<CleanupAllResult> {
  const collections = await resolveCollections();

  const catIdentifier =
    collections.categories.slugMap.get("external-id") ?? "external-id";
  const cityIdentifier =
    collections.cities.slugMap.get("external-id") ?? "external-id";
  const studioIdentifier =
    collections.studios.slugMap.get("external-id") ?? "external-id";

  const result: CleanupAllResult = {
    categories: emptyCleanupResult(),
    cities: emptyCleanupResult(),
    studios: emptyCleanupResult(),
  };

  // Step 1: Delete orphaned Studios
  result.studios = await cleanupDeletedItems(
    collections.studios.id,
    studioIds,
    webflow,
    webflowConfig.siteId,
    studioIdentifier,
    schedule,
  );

  // Step 2: Find Cities and Categories that will be deleted (parallel)
  const [cityIdsToDelete, categoryIdsToDelete] = await Promise.all([
    getOrphanedItems(
      collections.cities.id,
      cityIds,
      webflow,
      webflowConfig.siteId,
      cityIdentifier,
      schedule,
    ),
    getOrphanedItems(
      collections.categories.id,
      categoryIds,
      webflow,
      webflowConfig.siteId,
      catIdentifier,
      schedule,
    ),
  ]);

  // Step 3: Remove references from Studios BEFORE deleting Cities/Categories
  if (cityIdsToDelete.length > 0 || categoryIdsToDelete.length > 0) {
    const allIdsToRemove = new Set([
      ...cityIdsToDelete.map((item) => item.webflowItemId),
      ...categoryIdsToDelete.map((item) => item.webflowItemId),
    ]);

    // Use resolved slugs for reference field IDs
    const cityFieldSlug = collections.studios.slugMap.get("city") ?? "city";
    const categoriesFieldSlug =
      collections.studios.slugMap.get("categories") ?? "categories";

    const refResult = await removeReferencesToItems(
      collections.studios.id,
      [
        { fieldId: cityFieldSlug, isMulti: false },
        { fieldId: categoriesFieldSlug, isMulti: true },
      ],
      allIdsToRemove,
      webflow,
      webflowConfig.siteId,
      schedule,
    );

    // Add any errors from reference removal
    result.cities.errors.push(...refResult.errors);
  }

  // Step 4: Delete orphaned Cities
  const citiesCleanup = await cleanupDeletedItems(
    collections.cities.id,
    cityIds,
    webflow,
    webflowConfig.siteId,
    cityIdentifier,
    schedule,
  );
  result.cities = {
    ...citiesCleanup,
    errors: [...result.cities.errors, ...citiesCleanup.errors],
  };

  // Step 5: Delete orphaned Categories
  const categoriesCleanup = await cleanupDeletedItems(
    collections.categories.id,
    categoryIds,
    webflow,
    webflowConfig.siteId,
    catIdentifier,
    schedule,
  );
  result.categories = {
    ...categoriesCleanup,
    errors: [...result.categories.errors, ...categoriesCleanup.errors],
  };

  // Log summary
  const totalDeleted =
    result.categories.deleted + result.cities.deleted + result.studios.deleted;
  const totalErrors =
    result.studios.errors.length +
    result.cities.errors.length +
    result.categories.errors.length;

  console.log(
    `   ✅ Cleanup: ${totalDeleted} deleted${totalErrors > 0 ? ` (${totalErrors} errors)` : ""}`,
  );

  return result;
}
