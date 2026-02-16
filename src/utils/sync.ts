import type { WebflowClient } from "webflow-api";
import {
  fetchAllItems,
  fetchAndMapItemsByIdentifier,
  getLocales,
  type Scheduler,
  noopScheduler,
} from "./webflow.js";
import {
  batchDelete,
  batchCreate,
  batchUpdate,
  batchPublish,
} from "./batch.js";
import { validateCollectionSchema } from "./schema.js";
import type {
  LocalItem,
  SyncError,
  SyncOptions,
  SyncResult,
} from "../types.js";

/**
 * Build a lookup map from external identifier → Webflow item ID.
 *
 * Useful for resolving references between collections, e.g.
 * "What is the Webflow ID for category `cat-123`?"
 *
 * Fetches from ALL locales to catch items that might only exist
 * in a secondary locale.
 */
export async function getIdMap(
  collectionId: string,
  client: WebflowClient,
  siteId: string,
  identifierField: string = "external-id",
  schedule: Scheduler = noopScheduler,
): Promise<Map<string, string>> {
  const locales = await getLocales(client, siteId, schedule);
  const allLocaleIds = locales.map((l) => l.cmsLocaleId);

  const items = await fetchAllItems(
    collectionId,
    client,
    allLocaleIds,
    schedule,
  );
  const idMap = new Map<string, string>();

  for (const item of items) {
    const identifier = item.fieldData[identifierField] as string | undefined;
    if (identifier && item.id) {
      idMap.set(identifier, item.id);
    }
  }

  return idMap;
}

/**
 * Idempotent sync engine for any Webflow CMS collection.
 *
 * Every run converges to the same end state regardless of the current
 * Webflow state. Safe to re-run after partial failures — the engine
 * self-heals if an WF editor accidentally modifies, drafts, unpublishes,
 * or deletes locale variants.
 *
 * ## Flow
 *
 * 0. **Pre-flight** — validate schema if provided (abort on missing fields)
 * 1. **Discover** — fetch all existing items with locale variants
 * 2. **Categorize** — compare local items to remote:
 *    - `toCreate`: item doesn't exist in Webflow
 *    - `toRecreate`: item exists but is missing locale variants
 *    - `toUpdate`: item exists with all locales intact
 *    - `toDelete`: orphans, corrupted, or duplicates
 * 3. **Delete** — remove orphans, corrupted, and incomplete items
 * 4. **Create** — POST new + recreated items with all locales
 * 5. **Re-fetch** — get definitive Webflow IDs for all items
 * 6. **Update** — PATCH every item × every locale (staged)
 * 7. **Publish** — batch-publish all items across all locales
 */
export async function syncCollection<T extends LocalItem>(
  options: SyncOptions<T>,
  client: WebflowClient,
  schedule: Scheduler = noopScheduler,
): Promise<SyncResult> {
  const {
    collectionId,
    siteId,
    items,
    entityName,
    buildFieldData,
    identifierField = "external-id",
    schema,
  } = options;

  const startTime = Date.now();
  const name = entityName ?? collectionId;

  console.log(`\n📦 Syncing ${name}...`);
  console.log(`   Items to sync: ${items.length}`);

  const result: SyncResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    published: 0,
    skipped: 0,
    errors: [],
    duration: 0,
  };

  // Collect errors instead of throwing — we want to continue syncing
  // even if individual batches fail, so we can report all issues at once
  const addError = (
    step: SyncError["step"],
    message: string,
    itemId?: string,
  ) => {
    result.errors.push({ step, message, itemId });
  };

  // ── SETUP: verify collection & resolve locales ──

  try {
    await schedule(() => client.collections.get(collectionId));
  } catch {
    addError("general", `Collection not found: ${collectionId}`);
    result.duration = Date.now() - startTime;
    return result;
  }

  // ── PRE-FLIGHT: validate schema if provided ──

  if (schema) {
    const validation = await validateCollectionSchema(
      schema,
      siteId,
      client,
      schedule,
    );

    if (!validation.exists) {
      addError(
        "general",
        `Collection "${schema.slug}" does not exist. Run schema sync first.`,
      );
      result.duration = Date.now() - startTime;
      return result;
    }

    if (validation.missingFields.length > 0) {
      addError(
        "general",
        `Missing fields in Webflow: ${validation.missingFields.join(", ")}. ` +
          `Run schema sync first to create them.`,
      );
      result.duration = Date.now() - startTime;
      return result;
    }

    if (validation.typeMismatches.length > 0) {
      addError(
        "general",
        `Field type mismatches: ${validation.typeMismatches.join("; ")}. ` +
          `Fix these manually in Webflow before syncing data.`,
      );
      result.duration = Date.now() - startTime;
      return result;
    }
  }

  const locales = await getLocales(client, siteId, schedule);
  const primaryLocale = locales.find((l) => l.isPrimary);
  const allLocaleIds = locales.map((l) => l.cmsLocaleId);

  if (!primaryLocale) {
    addError("general", "No primary locale found");
    result.duration = Date.now() - startTime;
    return result;
  }

  // ── STEP 1: Discover & categorize ──

  const webflowMap = await fetchAndMapItemsByIdentifier(
    collectionId,
    client,
    allLocaleIds,
    identifierField,
    schedule,
  );

  // Build a simpler lookup: identifier → { webflowId, localesPresent }
  // Corrupted and duplicate groups are collected for immediate deletion.
  const existingByIdentifier = new Map<
    string,
    { webflowId: string; localesPresent: Set<string> }
  >();

  // IDs that must be purged regardless (corrupted or duplicate)
  const corruptedIds: string[] = [];

  for (const [extId, groups] of webflowMap) {
    // Duplicates: multiple Webflow item IDs for the same identifier
    // → delete ALL of them and let the item be (re)created cleanly
    if (groups.length > 1) {
      console.log(
        `   ⚠️ "${extId}" has ${groups.length} duplicate Webflow items → will purge all`,
      );
      for (const g of groups) corruptedIds.push(g.id);
      continue;
    }

    const group = groups[0];

    // Corrupted: locale variants disagree on the identifier field
    // → delete and recreate from source of truth
    if (group.corrupted) {
      console.log(
        `   ⚠️ "${extId}" is corrupted (locale variants have different identifiers) → will purge`,
      );
      corruptedIds.push(group.id);
      continue;
    }

    existingByIdentifier.set(extId, {
      webflowId: group.id,
      localesPresent: new Set(group.variants.map((v) => v.cmsLocaleId)),
    });
  }

  // Build a set of local IDs for fast orphan lookup
  const localIds = new Set(items.map((item) => item.id));

  // Categorize source items into three buckets
  const toCreate: T[] = [];
  const toRecreate: { item: T; webflowId: string }[] = [];
  const toUpdate: T[] = [];

  for (const item of items) {
    const existing = existingByIdentifier.get(item.id);

    if (!existing) {
      // Item doesn't exist cleanly in Webflow → create
      // (could have been purged above due to corruption/duplication)
      toCreate.push(item);
    } else {
      const hasAllLocales = allLocaleIds.every((id) =>
        existing.localesPresent.has(id),
      );

      if (hasAllLocales) {
        toUpdate.push(item);
      } else {
        // Missing locale variants — must delete and recreate
        const missing = allLocaleIds.filter(
          (id) => !existing.localesPresent.has(id),
        );
        console.log(
          `   ⚠️ "${item.id}" missing locales: ${missing.join(", ")} → will recreate`,
        );
        toRecreate.push({ item, webflowId: existing.webflowId });
      }
    }
  }

  // Detect orphans: clean items in Webflow that don't exist in local data
  const orphanIds: string[] = [];
  for (const [extId, entry] of existingByIdentifier) {
    if (!localIds.has(extId)) {
      orphanIds.push(entry.webflowId);
    }
  }

  console.log(
    `   To create: ${toCreate.length}, To recreate: ${toRecreate.length}, To update: ${toUpdate.length}, To delete: ${orphanIds.length + corruptedIds.length}`,
  );

  // ── STEP 2: Delete orphans, corrupted, and incomplete items ──

  const allIdsToDelete = [
    ...orphanIds,
    ...corruptedIds,
    ...toRecreate.map(({ webflowId }) => webflowId),
  ];

  const totalDeleted = await batchDelete(
    collectionId,
    allIdsToDelete,
    allLocaleIds,
    client,
    schedule,
    addError,
  );

  // Only count orphans + corrupted as "deleted" (recreates are tracked separately)
  result.deleted = Math.min(
    totalDeleted,
    orphanIds.length + corruptedIds.length,
  );

  // ── STEP 3: Create items (new + recreated) ──

  const allToCreate = [...toCreate, ...toRecreate.map(({ item }) => item)];
  const createFieldData = allToCreate.map((item) =>
    buildFieldData(item, primaryLocale.tag),
  );

  result.created = await batchCreate(
    collectionId,
    createFieldData,
    allLocaleIds,
    client,
    schedule,
    addError,
  );

  // ── STEP 4: Re-fetch all items to get definitive Webflow IDs ──
  // Handles items created in this run, ghost items from partial failures,
  // items created manually in the Designer, and recreated items with new IDs.

  const freshItems = await fetchAllItems(
    collectionId,
    client,
    allLocaleIds,
    schedule,
  );

  const idByIdentifier = new Map<string, string>();
  for (const item of freshItems) {
    const id = item.fieldData[identifierField] as string | undefined;
    if (id && item.id) idByIdentifier.set(id, item.id);
  }

  // ── STEP 5: Update ALL items × ALL locales (staged) ──
  // Uses the staged endpoint so changes can be batch-published in step 6.
  //
  // Batch size = floor(100 / localeCount) since each item expands to
  // N entries (one per locale) and Webflow limits to 100 per request.

  const updateEntries = items.flatMap((item) => {
    const webflowId = idByIdentifier.get(item.id);
    if (!webflowId) return []; // Skip — create might have failed

    return locales.map((locale) => {
      // Strip slug from update payloads — slug is set during creation
      // and must not be included here. Webflow validates slug uniqueness
      // across all entries in the batch, so sending the same slug for
      // multiple locale variants of the same item causes a conflict.
      const { slug, ...fieldData } = buildFieldData(item, locale.tag);
      return {
        id: webflowId,
        cmsLocaleId: locale.cmsLocaleId,
        fieldData,
      };
    });
  });

  const updatedEntries = await batchUpdate(
    collectionId,
    updateEntries,
    client,
    schedule,
    addError,
  );

  // Count unique items updated (entries ÷ locales)
  result.updated = Math.floor(updatedEntries / locales.length);

  // ── STEP 6: Publish ALL items across ALL locales ──
  // Batch-publish so every locale variant goes live. This handles:
  //   - Newly created items (start as isDraft/queued)
  //   - Recreated items
  //   - Items an editor drafted or unpublished
  //   - Staged changes from step 5
  //
  // IMPORTANT: must include cmsLocaleIds per item, otherwise only the
  // primary locale is published (same gotcha as with deleteItemsLive).

  const allWebflowIds = items
    .map((item) => idByIdentifier.get(item.id))
    .filter((id): id is string => !!id);

  result.published = await batchPublish(
    collectionId,
    allWebflowIds,
    allLocaleIds,
    client,
    schedule,
    addError,
  );

  // ── Summary ──

  result.duration = Date.now() - startTime;
  const hasErrors = result.errors.length > 0;

  console.log(
    `\n${hasErrors ? "⚠️" : "✅"} ${name} sync complete in ${result.duration}ms`,
  );
  console.log(
    `   Created: ${result.created}, Updated: ${result.updated}, Deleted: ${result.deleted}, Published: ${result.published}`,
  );

  if (hasErrors) {
    console.log(`   Errors: ${result.errors.length}`);
    for (const e of result.errors) {
      console.log(
        `     - [${e.step}] ${e.message}${e.itemId ? ` (${e.itemId})` : ""}`,
      );
    }
  }

  return result;
}
