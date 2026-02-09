import {
  webflow,
  webflowConfig,
  findCollectionBySlug,
  getPrimaryLocaleId,
  getLocaleIds,
} from "../webflow/client.js";
import { defaultItemState, type WebflowItem } from "./utils.js";

type CleanupResult = {
  deleted: number;
  deletedIds: string[];
  referencesRemoved: number;
  errors: string[];
};

type CleanupAllResult = {
  categories: CleanupResult;
  cities: CleanupResult;
  studios: CleanupResult;
};

// Helper to create empty cleanup result
const emptyCleanupResult = (): CleanupResult => ({
  deleted: 0,
  deletedIds: [],
  referencesRemoved: 0,
  errors: [],
});

// Get all items from a Webflow collection with their field data
async function getWebflowItems(collectionId: string) {
  const primaryCmsLocaleId = await getPrimaryLocaleId();
  const items = await webflow.collections.items.listItems(collectionId, {
    cmsLocaleId: primaryCmsLocaleId,
    limit: 100,
  });

  return (items.items ?? []).map((item) => ({
    id: item.id!,
    externalId: (item.fieldData as any)?.["external-id"] as string,
    fieldData: item.fieldData as Record<string, unknown>,
  }));
}

/**
 * Remove references to items that will be deleted from all referencing items.
 * This must be done BEFORE deleting the actual items to avoid Webflow errors.
 *
 * @param referencingCollectionSlug - The collection that contains references (e.g., "studios")
 * @param referenceFields - Field names that contain references to the target collection
 * @param idsToRemove - Set of Webflow item IDs that will be deleted
 */
async function removeReferencesToItems(
  referencingCollectionSlug: string,
  referenceFields: { fieldName: string; isMulti: boolean }[],
  idsToRemove: Set<string>,
): Promise<{ updated: number; errors: string[] }> {
  const result = { updated: 0, errors: [] as string[] };

  if (idsToRemove.size === 0) return result;

  const collection = await findCollectionBySlug(
    webflowConfig.siteId,
    referencingCollectionSlug,
  );
  if (!collection) {
    result.errors.push(`Collection "${referencingCollectionSlug}" not found`);
    return result;
  }

  const localeIds = await getLocaleIds();
  const items = await getWebflowItems(collection.id);

  // Find items that have references to the items being deleted
  const itemsToUpdate: {
    id: string;
    fieldData: Record<string, unknown>;
  }[] = [];

  for (const item of items) {
    let needsUpdate = false;
    const updatedFieldData: Record<string, unknown> = {};

    for (const { fieldName, isMulti } of referenceFields) {
      const fieldValue = item.fieldData[fieldName];

      if (isMulti && Array.isArray(fieldValue)) {
        // MultiReference: filter out deleted IDs
        const filtered = fieldValue.filter((id) => !idsToRemove.has(id));
        if (filtered.length !== fieldValue.length) {
          updatedFieldData[fieldName] = filtered;
          needsUpdate = true;
        }
      } else if (!isMulti && typeof fieldValue === "string") {
        // Single Reference: set to null if it references a deleted item
        if (idsToRemove.has(fieldValue)) {
          updatedFieldData[fieldName] = null;
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      itemsToUpdate.push({
        id: item.id,
        fieldData: updatedFieldData,
      });
    }
  }

  if (itemsToUpdate.length === 0) {
    return result;
  }

  try {
    // Update ALL locales in a single API call
    // Flatten items × locales into one array for efficiency
    await webflow.collections.items.updateItemsLive(collection.id, {
      items: itemsToUpdate.flatMap((item) =>
        localeIds.map((localeId) => ({
          ...defaultItemState,
          id: item.id,
          cmsLocaleId: localeId,
          fieldData: item.fieldData,
        })),
      ) as WebflowItem[],
    });

    result.updated = itemsToUpdate.length;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Failed to remove references: ${errorMsg}`);
  }

  return result;
}

/**
 * Delete items from a Webflow collection that no longer exist in the database.
 * Returns the Webflow IDs of deleted items (useful for reference cleanup).
 */
async function cleanupDeletedItems(
  collectionSlug: string,
  dbExternalIds: Set<string>,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deleted: 0,
    deletedIds: [],
    referencesRemoved: 0,
    errors: [],
  };

  const localeIds = await getLocaleIds();

  const collection = await findCollectionBySlug(
    webflowConfig.siteId,
    collectionSlug,
  );
  if (!collection) {
    result.errors.push(`Collection "${collectionSlug}" not found`);
    return result;
  }

  const webflowItems = await getWebflowItems(collection.id);

  // Find items that exist in Webflow but not in the database
  const itemsToDelete = webflowItems.filter(
    (item) => item.externalId && !dbExternalIds.has(item.externalId),
  );

  if (itemsToDelete.length === 0) {
    return result;
  }

  // Delete the items from both live AND staged to remove completely
  try {
    // Step 1: Delete from live (unpublishes the items)
    await webflow.collections.items.deleteItemsLive(collection.id, {
      items: itemsToDelete.map((item) => ({
        id: item.id,
        cmsLocaleIds: localeIds,
      })),
    });

    // Step 2: Delete from staged (removes the draft completely)
    await webflow.collections.items.deleteItems(collection.id, {
      items: itemsToDelete.map((item) => ({
        id: item.id,
        cmsLocaleIds: localeIds,
      })),
    });

    result.deleted = itemsToDelete.length;
    result.deletedIds = itemsToDelete.map((i) => i.externalId);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Failed to delete items: ${errorMsg}`);
  }

  return result;
}

/**
 * Get the Webflow IDs of items that will be deleted (items not in dbExternalIds).
 * Used to identify which references need to be removed before deletion.
 */
async function getIdsToDelete(
  collectionSlug: string,
  dbExternalIds: Set<string>,
): Promise<Set<string>> {
  const collection = await findCollectionBySlug(
    webflowConfig.siteId,
    collectionSlug,
  );
  if (!collection) return new Set();

  const webflowItems = await getWebflowItems(collection.id);

  return new Set(
    webflowItems
      .filter((item) => item.externalId && !dbExternalIds.has(item.externalId))
      .map((item) => item.id),
  );
}

/**
 * Cleanup all collections with proper reference handling.
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
  const result: CleanupAllResult = {
    categories: emptyCleanupResult(),
    cities: emptyCleanupResult(),
    studios: emptyCleanupResult(),
  };

  // Step 1: Delete orphaned Studios
  result.studios = await cleanupDeletedItems(
    webflowConfig.collectionSlugs.studios,
    studioIds,
  );

  // Step 2: Find Cities and Categories that will be deleted (parallel)
  const [cityIdsToDelete, categoryIdsToDelete] = await Promise.all([
    getIdsToDelete(webflowConfig.collectionSlugs.cities, cityIds),
    getIdsToDelete(webflowConfig.collectionSlugs.categories, categoryIds),
  ]);

  // Step 3: Remove references from Studios BEFORE deleting Cities/Categories
  if (cityIdsToDelete.size > 0 || categoryIdsToDelete.size > 0) {
    const allIdsToRemove = new Set([
      ...cityIdsToDelete,
      ...categoryIdsToDelete,
    ]);

    const refResult = await removeReferencesToItems(
      webflowConfig.collectionSlugs.studios,
      [
        { fieldName: "city", isMulti: false },
        { fieldName: "categories", isMulti: true },
      ],
      allIdsToRemove,
    );

    result.cities.referencesRemoved =
      cityIdsToDelete.size > 0 ? refResult.updated : 0;
    result.categories.referencesRemoved =
      categoryIdsToDelete.size > 0 ? refResult.updated : 0;
    result.cities.errors.push(...refResult.errors);
  }

  // Step 4: Delete orphaned Cities
  const citiesCleanup = await cleanupDeletedItems(
    webflowConfig.collectionSlugs.cities,
    cityIds,
  );
  Object.assign(result.cities, citiesCleanup);

  // Step 5: Delete orphaned Categories
  const categoriesCleanup = await cleanupDeletedItems(
    webflowConfig.collectionSlugs.categories,
    categoryIds,
  );
  Object.assign(result.categories, categoriesCleanup);

  // Log summary
  const totalDeleted =
    result.categories.deleted + result.cities.deleted + result.studios.deleted;
  const totalRefs =
    result.cities.referencesRemoved + result.categories.referencesRemoved;
  const hasErrors =
    result.studios.errors.length +
      result.cities.errors.length +
      result.categories.errors.length >
    0;

  console.log(
    `Cleanup: ${totalDeleted} deleted, ${totalRefs} refs removed${hasErrors ? " (with errors)" : ""}`,
  );

  return result;
}
