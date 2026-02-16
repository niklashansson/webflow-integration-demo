import type { WebflowClient } from "webflow-api";
import type { CollectionItemFieldData } from "webflow-api/api/index.js";
import type { Scheduler } from "./webflow.js";
import type { SyncError } from "../types.js";

type ErrorCollector = (
  step: SyncError["step"],
  message: string,
  itemId?: string,
) => void;

/**
 * Double-delete pattern: unpublish + permanently delete items from
 * ALL locales. Without explicit `cmsLocaleIds`, Webflow only removes
 * the primary locale, leaving secondary variant slugs behind.
 *
 * @returns Number of items successfully deleted
 */
export async function batchDelete(
  collectionId: string,
  itemIds: string[],
  cmsLocaleIds: string[],
  client: WebflowClient,
  schedule: Scheduler,
  addError: ErrorCollector,
): Promise<number> {
  if (itemIds.length === 0) return 0;

  let deleted = 0;
  const batchSize = 100;

  for (let i = 0; i < itemIds.length; i += batchSize) {
    const batch = itemIds.slice(i, i + batchSize);
    const payload = batch.map((id) => ({ id, cmsLocaleIds }));

    try {
      // Step 1: Unpublish from ALL locales
      await schedule(() =>
        client.collections.items.deleteItemsLive(collectionId, {
          items: payload,
        }),
      );

      // Step 2: Permanently delete from ALL locales
      await schedule(() =>
        client.collections.items.deleteItems(collectionId, {
          items: payload,
        }),
      );

      deleted += batch.length;
    } catch (err) {
      addError(
        "delete",
        err instanceof Error ? err.message : "Failed to delete items",
      );
    }
  }

  return deleted;
}

/**
 * Create items across all locales in one call per batch.
 *
 * Webflow's `createItems` endpoint accepts `cmsLocaleIds` to create
 * one variant per locale, all linked by a shared Webflow item ID.
 * Field data is built for the primary locale only — secondary locales
 * get their data via the update step.
 *
 * @returns Number of items successfully created
 */
export async function batchCreate(
  collectionId: string,
  fieldDataArray: CollectionItemFieldData[],
  cmsLocaleIds: string[],
  client: WebflowClient,
  schedule: Scheduler,
  addError: ErrorCollector,
): Promise<number> {
  if (fieldDataArray.length === 0) return 0;

  let created = 0;
  const batchSize = 100;

  for (let i = 0; i < fieldDataArray.length; i += batchSize) {
    const batch = fieldDataArray.slice(i, i + batchSize);

    try {
      await schedule(() =>
        client.collections.items.createItems(collectionId, {
          fieldData: batch,
          cmsLocaleIds,
          isDraft: false,
        }),
      );

      created += batch.length;
    } catch (err) {
      addError(
        "create",
        err instanceof Error ? err.message : "Failed to create items",
      );
    }
  }

  return created;
}

/** Single entry in an update payload */
type UpdateEntry = {
  id: string;
  cmsLocaleId: string;
  fieldData: Record<string, unknown>;
};

/**
 * Update items across all locales using the staged endpoint.
 *
 * Each entry in the payload is `{ id, cmsLocaleId, fieldData }`.
 * Webflow limits to 100 entries per request, so the batch size is
 * `floor(100 / localeCount)` items (each item expands to N entries,
 * one per locale).
 *
 * @returns Number of items successfully updated
 */
export async function batchUpdate(
  collectionId: string,
  entries: UpdateEntry[],
  client: WebflowClient,
  schedule: Scheduler,
  addError: ErrorCollector,
): Promise<number> {
  if (entries.length === 0) return 0;

  let updated = 0;
  const batchSize = 100;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);

    try {
      await schedule(() =>
        client.collections.items.updateItems(collectionId, {
          items: batch,
        }),
      );

      updated += batch.length;
    } catch (err) {
      addError(
        "update",
        err instanceof Error ? err.message : "Failed to update items",
      );
    }
  }

  return updated;
}

/**
 * Publish items across ALL locales.
 *
 * IMPORTANT: must include `cmsLocaleIds` per item, otherwise Webflow
 * only publishes the primary locale (same gotcha as `deleteItemsLive`).
 *
 * If the site has never been published, Webflow returns a 409 Conflict.
 * This is non-critical — items are created/updated, just not live.
 * We log a warning and skip remaining publish attempts.
 *
 * @returns Number of items successfully published
 */
export async function batchPublish(
  collectionId: string,
  itemIds: string[],
  cmsLocaleIds: string[],
  client: WebflowClient,
  schedule: Scheduler,
  addError: ErrorCollector,
): Promise<number> {
  if (itemIds.length === 0) return 0;

  let published = 0;
  const batchSize = 100;

  for (let i = 0; i < itemIds.length; i += batchSize) {
    const batch = itemIds.slice(i, i + batchSize);

    try {
      await schedule(() =>
        client.collections.items.publishItem(collectionId, {
          items: batch.map((id) => ({ id, cmsLocaleIds })),
        }),
      );

      published += batch.length;
    } catch (err) {
      // Detect "site not published" — skip remaining publishes
      const message = err instanceof Error ? err.message : String(err);
      if (isSiteNotPublishedError(err)) {
        console.warn(
          `   ⚠️ Skipping publish — site has not been published yet. ` +
            `Publish the site manually in Webflow first, then re-sync.`,
        );
        return published;
      }

      addError("publish", message);
    }
  }

  return published;
}

/**
 * Check if an error is the Webflow "site is not published" 409 Conflict.
 */
function isSiteNotPublishedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;

  // The Webflow SDK throws errors with a `statusCode` property
  const status = (err as { statusCode?: number }).statusCode;
  const message = (err as { message?: string }).message ?? "";

  return status === 409 && message.toLowerCase().includes("not published");
}
