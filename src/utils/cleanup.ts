import type { WebflowClient } from "webflow-api";
import {
  fetchAllItems,
  getLocales,
  type Scheduler,
  noopScheduler,
} from "./webflow.js";
import type {
  CleanupResult,
  CleanupReferencesToItemResult,
  ReferenceFieldDescriptor,
} from "../types.js";

/**
 * Scans all items in `referencingCollectionId` and for each reference
 * field in `referenceFields`:
 *   - **Single Reference**: set to `null` if it points to an orphaned ID
 *   - **Multi Reference**: filter out orphaned IDs from the array
 *
 * Updates are published live (`updateItemsLive`) across ALL locales
 * simultaneously so the live site never contains dangling references.
 *
 * Batch size = floor(100 / localeCount) to stay within Webflow's
 * 100-entry-per-request limit.
 */
export async function removeReferencesToItems(
  referencingCollectionId: string,
  referenceFields: ReferenceFieldDescriptor[],
  idsToRemove: Set<string>,
  client: WebflowClient,
  siteId: string,
  schedule: Scheduler = noopScheduler,
): Promise<CleanupReferencesToItemResult> {
  const result: CleanupReferencesToItemResult = {
    updated: 0,
    errors: [],
  };

  // Nothing to clean up
  if (idsToRemove.size === 0) return result;

  const locales = await getLocales(client, siteId, schedule);
  const allLocaleIds = locales.map((l) => l.cmsLocaleId);

  const primaryItems = await fetchAllItems(
    referencingCollectionId,
    client,
    allLocaleIds,
    schedule,
  );

  // Scan all items and build a list of items that contain stale references
  const itemsToUpdate: { id: string; fieldData: Record<string, unknown> }[] =
    [];

  for (const item of primaryItems) {
    if (!item.id) continue;

    let needsUpdate = false;
    const updatedFieldData: Record<string, unknown> = {};

    for (const { fieldId, isMulti } of referenceFields) {
      const fieldValue = item.fieldData[fieldId];

      if (isMulti && Array.isArray(fieldValue)) {
        // Multi-reference: filter out the orphaned IDs
        const filtered = fieldValue.filter((id) => !idsToRemove.has(id));
        if (filtered.length !== fieldValue.length) {
          updatedFieldData[fieldId] = filtered;
          needsUpdate = true;
        }
      } else if (!isMulti && typeof fieldValue === "string") {
        // Single reference: null it out if it points to an orphaned item
        if (idsToRemove.has(fieldValue)) {
          updatedFieldData[fieldId] = null;
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      itemsToUpdate.push({ id: item.id, fieldData: updatedFieldData });
    }
  }

  if (itemsToUpdate.length === 0) return result;

  console.log(
    `   🧹 Cleaning references: ${itemsToUpdate.length} items to update`,
  );

  // Batch size accounts for locale expansion: each item × each locale = 1 entry
  const batchSize = Math.max(1, Math.floor(100 / locales.length));

  for (let i = 0; i < itemsToUpdate.length; i += batchSize) {
    const batch = itemsToUpdate.slice(i, i + batchSize);

    try {
      // Expand each item across all locales
      const payload = batch.flatMap((item) =>
        locales.map((locale) => ({
          id: item.id,
          cmsLocaleId: locale.cmsLocaleId,
          fieldData: item.fieldData,
        })),
      );

      await schedule(() =>
        client.collections.items.updateItemsLive(referencingCollectionId, {
          items: payload,
        }),
      );

      result.updated += batch.length;
    } catch (err) {
      result.errors.push({
        step: "reference",
        message:
          err instanceof Error ? err.message : "Failed to update references",
      });
    }
  }

  return result;
}

/**
 * Compares Webflow items against `sourceIds` and removes any items that
 * no longer exist in the source data.
 *
 * Uses the **Double-Delete Pattern** to fully remove an item and its
 * slug from ALL locales:
 *   1. `deleteItemsLive` — unpublish from all locales
 *   2. `deleteItems` — permanently delete from all locales
 *
 * Without explicit `cmsLocaleIds`, Webflow only unpublishes the primary
 * locale, leaving secondary locale variants and their slugs behind.
 *
 * Batches are capped at 100 items per request.
 */
export async function cleanupDeletedItems(
  collectionId: string,
  sourceIds: Set<string>,
  client: WebflowClient,
  siteId: string,
  identifierField: string = "external-id",
  schedule: Scheduler = noopScheduler,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    deleted: 0,
    deletedIdentifiers: [],
    deletedWebflowIds: [],
    errors: [],
  };

  // Fetch locales so we can unpublish from ALL locales
  const locales = await getLocales(client, siteId, schedule);
  const cmsLocaleIds = locales.map((l) => l.cmsLocaleId);

  const webflowItems = await fetchAllItems(
    collectionId,
    client,
    cmsLocaleIds,
    schedule,
  );

  // Find items that exist in Webflow but not in the source data
  const itemsToDelete = webflowItems
    .filter((item) => {
      const sourceId = item.fieldData[identifierField] as string | undefined;
      return sourceId && item.id && !sourceIds.has(sourceId);
    })
    .map((item) => ({
      sourceId: item.fieldData[identifierField] as string,
      webflowItemId: item.id!,
    }));

  if (itemsToDelete.length === 0) return result;

  console.log(`   🗑️ Deleting ${itemsToDelete.length} orphaned items`);

  const batchSize = 100;

  for (let i = 0; i < itemsToDelete.length; i += batchSize) {
    const batch = itemsToDelete.slice(i, i + batchSize);

    try {
      // Step 1: Unpublish from ALL locales
      await schedule(() =>
        client.collections.items.deleteItemsLive(collectionId, {
          items: batch.map((item) => ({
            id: item.webflowItemId,
            cmsLocaleIds,
          })),
        }),
      );

      // Step 2: Permanently delete from ALL locales
      await schedule(() =>
        client.collections.items.deleteItems(collectionId, {
          items: batch.map((item) => ({
            id: item.webflowItemId,
            cmsLocaleIds,
          })),
        }),
      );

      // Track what was deleted for reporting
      for (const item of batch) {
        result.deleted++;
        result.deletedWebflowIds.push(item.webflowItemId);
        result.deletedIdentifiers.push(item.sourceId);
      }
    } catch (err) {
      result.errors.push({
        step: "delete",
        message: err instanceof Error ? err.message : "Failed to delete items",
        collectionId,
      });
      console.error(`   ❌ Delete batch failed:`, err);
    }
  }

  return result;
}

/**
 * Get all items in a collection that are NOT in the source data.
 *
 * Returns an array of `{ sourceId, webflowItemId }` tuples
 * representing orphaned items that should be deleted.
 *
 * Used internally within `cleanupDeletedItems` but also exported
 * for pre-flight reference cleaning (e.g. removing references
 * from Studios before deleting Cities/Categories).
 */
export async function getOrphanedItems(
  collectionId: string,
  sourceIds: Set<string>,
  client: WebflowClient,
  siteId: string,
  identifierField: string = "external-id",
  schedule: Scheduler = noopScheduler,
): Promise<{ sourceId: string; webflowItemId: string }[]> {
  const locales = await getLocales(client, siteId, schedule);
  const allLocaleIds = locales.map((l) => l.cmsLocaleId);

  const webflowItems = await fetchAllItems(
    collectionId,
    client,
    allLocaleIds,
    schedule,
  );

  return webflowItems
    .filter((item) => {
      const sourceId = item.fieldData[identifierField] as string | undefined;
      return sourceId && item.id && !sourceIds.has(sourceId);
    })
    .map((item) => ({
      sourceId: item.fieldData[identifierField] as string,
      webflowItemId: item.id!,
    }));
}
