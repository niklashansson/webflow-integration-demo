import { webflow, webflowConfig, findCollectionBySlug, getPrimaryLocaleId, getLocaleIds, getAllCollectionItems, } from "../webflow/client.js";
import { defaultItemState } from "./utils.js";
import { withRateLimit } from "../webflow/rate-limiter.js";
// Helper to create empty cleanup result
const emptyCleanupResult = () => ({
    deleted: 0,
    deletedExternalIds: [],
    deletedWebflowIds: [],
    referencesRemoved: 0,
    errors: [],
});
/**
 * Get all items from a Webflow collection with their field data.
 * Uses pagination to fetch ALL items, not just first 100.
 */
async function getWebflowItems(collectionId) {
    const primaryCmsLocaleId = await getPrimaryLocaleId();
    // Use paginated fetch to get ALL items
    const items = await getAllCollectionItems(collectionId, primaryCmsLocaleId);
    return items
        .map((item) => ({
        id: item.id,
        externalId: item.fieldData?.["external-id"],
        fieldData: item.fieldData,
    }))
        .filter((item) => item.id && item.externalId);
}
/**
 * Remove references to items that will be deleted from all referencing items.
 * This must be done BEFORE deleting the actual items to avoid Webflow errors.
 *
 * @param referencingCollectionSlug - The collection that contains references (e.g., "studios")
 * @param referenceFields - Field names that contain references to the target collection
 * @param idsToRemove - Set of Webflow item IDs that will be deleted
 */
async function removeReferencesToItems(referencingCollectionSlug, referenceFields, idsToRemove) {
    const result = { updated: 0, errors: [] };
    if (idsToRemove.size === 0)
        return result;
    const collection = await findCollectionBySlug(webflowConfig.siteId, referencingCollectionSlug);
    if (!collection) {
        result.errors.push(`Collection "${referencingCollectionSlug}" not found`);
        return result;
    }
    const localeIds = await getLocaleIds();
    const items = await getWebflowItems(collection.id);
    // Find items that have references to the items being deleted
    const itemsToUpdate = [];
    for (const item of items) {
        let needsUpdate = false;
        const updatedFieldData = {};
        for (const { fieldName, isMulti } of referenceFields) {
            const fieldValue = item.fieldData[fieldName];
            if (isMulti && Array.isArray(fieldValue)) {
                // MultiReference: filter out deleted IDs
                const filtered = fieldValue.filter((id) => !idsToRemove.has(id));
                if (filtered.length !== fieldValue.length) {
                    updatedFieldData[fieldName] = filtered;
                    needsUpdate = true;
                }
            }
            else if (!isMulti && typeof fieldValue === "string") {
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
        await withRateLimit(() => webflow.collections.items.updateItemsLive(collection.id, {
            items: itemsToUpdate.flatMap((item) => localeIds.map((localeId) => ({
                ...defaultItemState,
                id: item.id,
                cmsLocaleId: localeId,
                fieldData: item.fieldData,
            }))),
        }));
        result.updated = itemsToUpdate.length;
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Failed to remove references: ${errorMsg}`);
    }
    return result;
}
/**
 * Delete items from a Webflow collection that no longer exist in the database.
 * Returns both external IDs and Webflow IDs of deleted items.
 */
async function cleanupDeletedItems(collectionSlug, dbExternalIds) {
    const result = emptyCleanupResult();
    const localeIds = await getLocaleIds();
    const collection = await findCollectionBySlug(webflowConfig.siteId, collectionSlug);
    if (!collection) {
        result.errors.push(`Collection "${collectionSlug}" not found`);
        return result;
    }
    const webflowItems = await getWebflowItems(collection.id);
    // Find items that exist in Webflow but not in the database
    const itemsToDelete = webflowItems.filter((item) => item.externalId && !dbExternalIds.has(item.externalId));
    if (itemsToDelete.length === 0) {
        return result;
    }
    // Delete the items from both live AND staged to remove completely
    try {
        // Step 1: Delete from live (unpublishes the items)
        await withRateLimit(() => webflow.collections.items.deleteItemsLive(collection.id, {
            items: itemsToDelete.map((item) => ({
                id: item.id,
                cmsLocaleIds: localeIds,
            })),
        }));
        // Step 2: Delete from staged (removes the draft completely)
        await withRateLimit(() => webflow.collections.items.deleteItems(collection.id, {
            items: itemsToDelete.map((item) => ({
                id: item.id,
                cmsLocaleIds: localeIds,
            })),
        }));
        result.deleted = itemsToDelete.length;
        result.deletedExternalIds = itemsToDelete.map((i) => i.externalId);
        result.deletedWebflowIds = itemsToDelete.map((i) => i.id);
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Failed to delete items: ${errorMsg}`);
    }
    return result;
}
/**
 * Get the Webflow IDs of items that will be deleted (items not in dbExternalIds).
 * Used to identify which references need to be removed before deletion.
 */
async function getIdsToDelete(collectionSlug, dbExternalIds) {
    const collection = await findCollectionBySlug(webflowConfig.siteId, collectionSlug);
    if (!collection)
        return new Set();
    const webflowItems = await getWebflowItems(collection.id);
    return new Set(webflowItems
        .filter((item) => item.externalId && !dbExternalIds.has(item.externalId))
        .map((item) => item.id));
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
export async function cleanupAll(categoryIds, cityIds, studioIds) {
    const result = {
        categories: emptyCleanupResult(),
        cities: emptyCleanupResult(),
        studios: emptyCleanupResult(),
    };
    // Step 1: Delete orphaned Studios
    result.studios = await cleanupDeletedItems(webflowConfig.collectionSlugs.studios, studioIds);
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
        const refResult = await removeReferencesToItems(webflowConfig.collectionSlugs.studios, [
            { fieldName: "city", isMulti: false },
            { fieldName: "categories", isMulti: true },
        ], allIdsToRemove);
        // Track references removed separately for each collection type
        if (cityIdsToDelete.size > 0) {
            result.cities.referencesRemoved = refResult.updated;
        }
        if (categoryIdsToDelete.size > 0) {
            result.categories.referencesRemoved = refResult.updated;
        }
        // Add any errors from reference removal
        result.cities.errors.push(...refResult.errors);
    }
    // Step 4: Delete orphaned Cities
    const citiesCleanup = await cleanupDeletedItems(webflowConfig.collectionSlugs.cities, cityIds);
    // Merge results properly without overwriting referencesRemoved
    result.cities = {
        ...citiesCleanup,
        referencesRemoved: result.cities.referencesRemoved,
        errors: [...result.cities.errors, ...citiesCleanup.errors],
    };
    // Step 5: Delete orphaned Categories
    const categoriesCleanup = await cleanupDeletedItems(webflowConfig.collectionSlugs.categories, categoryIds);
    // Merge results properly without overwriting referencesRemoved
    result.categories = {
        ...categoriesCleanup,
        referencesRemoved: result.categories.referencesRemoved,
        errors: [...result.categories.errors, ...categoriesCleanup.errors],
    };
    // Log summary
    const totalDeleted = result.categories.deleted + result.cities.deleted + result.studios.deleted;
    const totalRefs = result.cities.referencesRemoved + result.categories.referencesRemoved;
    const hasErrors = result.studios.errors.length +
        result.cities.errors.length +
        result.categories.errors.length >
        0;
    console.log(`   ✅ Cleanup: ${totalDeleted} deleted, ${totalRefs} refs removed${hasErrors ? " (with errors)" : ""}`);
    return result;
}
/**
 * Delete ALL items from a single collection.
 * Removes from both live and staged to completely purge items.
 * Uses pagination to handle collections with 100+ items.
 */
async function purgeCollection(collectionSlug) {
    const result = {
        collection: collectionSlug,
        deleted: 0,
        errors: [],
    };
    const collection = await findCollectionBySlug(webflowConfig.siteId, collectionSlug);
    if (!collection) {
        result.errors.push(`Collection "${collectionSlug}" not found`);
        return result;
    }
    const localeIds = await getLocaleIds();
    const items = await getWebflowItems(collection.id);
    if (items.length === 0) {
        console.log(`   ⏭️  ${collectionSlug}: No items to delete`);
        return result;
    }
    try {
        // Delete from live first (unpublishes)
        await withRateLimit(() => webflow.collections.items.deleteItemsLive(collection.id, {
            items: items.map((item) => ({
                id: item.id,
                cmsLocaleIds: localeIds,
            })),
        }));
        // Then delete from staged (removes drafts)
        await withRateLimit(() => webflow.collections.items.deleteItems(collection.id, {
            items: items.map((item) => ({
                id: item.id,
                cmsLocaleIds: localeIds,
            })),
        }));
        result.deleted = items.length;
        console.log(`   🗑️  ${collectionSlug}: Deleted ${items.length} items`);
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Failed to delete items: ${errorMsg}`);
        console.error(`   ❌ ${collectionSlug}: ${errorMsg}`);
    }
    return result;
}
/**
 * Purge ALL items from ALL collections.
 *
 * ⚠️ WARNING: This is destructive and cannot be undone!
 *
 * Order of deletion:
 * 1. Studios (references Cities and Categories)
 * 2. Cities (no remaining references)
 * 3. Categories (no remaining references)
 */
export async function purgeAllCollections() {
    console.log("\n🗑️  Purging all collections...");
    // Delete in order: Studios first (has references), then Cities, then Categories
    const studios = await purgeCollection(webflowConfig.collectionSlugs.studios);
    const cities = await purgeCollection(webflowConfig.collectionSlugs.cities);
    const categories = await purgeCollection(webflowConfig.collectionSlugs.categories);
    const totalDeleted = studios.deleted + cities.deleted + categories.deleted;
    console.log(`\n✅ Purge complete: ${totalDeleted} total items deleted`);
    return {
        studios,
        cities,
        categories,
        totalDeleted,
    };
}
