import {
  webflow,
  webflowConfig,
  findCollectionBySlug,
  getSiteLocales,
  getLocaleIds,
  getPrimaryLocaleId,
  mapWebflowTagToLocale,
  type WebflowLocale,
} from "../webflow/client.js";
import { PRIMARY_LOCALE, type SupportedLocale } from "../db/index.js";
import type {
  CollectionItemWithIdInput,
  CollectionItemWithIdInputFieldData,
} from "webflow-api/api/index.js";
import type { CreateBulkCollectionItemRequestBodyFieldDataItem } from "webflow-api/api/resources/collections/index.js";

// Combined type for Webflow item with field data
export type WebflowItem = CollectionItemWithIdInput &
  CollectionItemWithIdInputFieldData;

// Sync result type with detailed error tracking
export type SyncResult = {
  created: number;
  updated: number;
  published: number;
  errors: { step: string; message: string; itemId?: string }[];
  duration: number;
};

// Default state for all items (not archived, not draft)
export const defaultItemState = { isArchived: false, isDraft: false };

// Generic type for an entity with an id
type EntityWithId = { id: string };

// Options for the generic sync function
type SyncCollectionOptions<T extends EntityWithId> = {
  /** The collection slug to sync to */
  collectionSlug: string;
  /** Human-readable name for logging (e.g., "Categories") */
  entityName: string;
  /** The items to sync from the database */
  items: T[];
  /** Function to build field data for a specific locale */
  buildFieldData: (
    item: T,
    locale: SupportedLocale,
  ) => CreateBulkCollectionItemRequestBodyFieldDataItem;
};

/**
 * Generic sync function for syncing any collection to Webflow CMS.
 *
 * Strategy:
 * 1. Fetch existing items from Webflow
 * 2. Split into "to create" and "to update" based on external-id
 * 3. Create new items in all locales, then update secondary locales
 * 4. Update existing items in all locales
 * 5. Publish all changes
 */
export async function syncCollection<T extends EntityWithId>(
  options: SyncCollectionOptions<T>,
): Promise<SyncResult> {
  const { collectionSlug, entityName, items, buildFieldData } = options;
  const startTime = Date.now();
  console.log(`\n📁 Syncing ${items.length} ${entityName.toLowerCase()}...`);

  const result: SyncResult = {
    created: 0,
    updated: 0,
    published: 0,
    errors: [],
    duration: 0,
  };

  // Helper to push errors
  const addError = (step: string, message: string, itemId?: string) => {
    result.errors.push({ step, message, itemId });
  };

  // --- Setup: Get collection and locale config ---
  const collection = await findCollectionBySlug(
    webflowConfig.siteId,
    collectionSlug,
  );
  if (!collection) {
    addError("setup", `${entityName} collection not found`);
    result.duration = Date.now() - startTime;
    return result;
  }

  const locales = await getSiteLocales();
  const localeIds = await getLocaleIds();
  const primaryLocaleId = await getPrimaryLocaleId();
  const secondaryLocales = locales.filter((l) => !l.isPrimary);

  console.log(
    `   Locales: ${locales.map((l) => l.tag).join(", ")} (${locales.length} total)`,
  );

  // --- Step 1: Fetch existing items from Webflow ---
  const existingMap = new Map<string, string>();

  try {
    const existing = await webflow.collections.items.listItems(collection.id, {
      limit: 100,
      cmsLocaleId: primaryLocaleId,
    });
    const existingItems = existing.items ?? [];

    existingItems.forEach((item) => {
      existingMap.set(item.fieldData["external-id"], item.id!);
    });
    console.log(`   Found ${existingItems.length} existing items in Webflow`);
  } catch (error) {
    addError(
      "fetch",
      error instanceof Error ? error.message : "Failed to fetch items",
    );
    result.duration = Date.now() - startTime;
    return result;
  }

  // --- Step 2: Split into create vs update ---
  const toCreate = items.filter((item) => !existingMap.has(item.id));
  const toUpdate = items.filter((item) => existingMap.has(item.id));

  console.log(
    `   To create: ${toCreate.length}, To update: ${toUpdate.length}`,
  );

  // --- Step 3: Create new items ---
  const createdPrimaryIds: string[] = [];

  if (toCreate.length > 0) {
    try {
      // Create items in all locales with primary locale data
      const created = (await webflow.collections.items.createItems(
        collection.id,
        {
          ...defaultItemState,
          fieldData: toCreate.map((item) =>
            buildFieldData(item, PRIMARY_LOCALE),
          ),
          cmsLocaleIds: localeIds,
        },
      )) as { items: WebflowItem[] };

      createdPrimaryIds.push(...new Set(created.items.map((c) => c.id)));
      result.created = toCreate.length;
      console.log(
        `   ✅ Created ${toCreate.length} ${entityName.toLowerCase()}`,
      );

      // Update secondary locales with translated content
      for (const locale of secondaryLocales) {
        const dbLocale = mapWebflowTagToLocale(locale.tag);
        if (!dbLocale) {
          addError("create-locale", `No mapping for locale tag: ${locale.tag}`);
          continue;
        }

        const localeItems = toCreate
          .map((item) => {
            const createdItem = created.items.find(
              (ci) => ci.fieldData?.["external-id"] === item.id,
            );
            if (!createdItem) {
              addError("create-locale", "Created item not found", item.id);
              return;
            }

            return {
              ...defaultItemState,
              id: createdItem.id,
              cmsLocaleId: locale.cmsLocaleId,
              fieldData: buildFieldData(item, dbLocale),
            };
          })
          .filter(Boolean) as WebflowItem[];

        if (localeItems.length > 0) {
          await webflow.collections.items.updateItems(collection.id, {
            items: localeItems,
          });
          console.log(
            `   ✅ Updated ${locale.displayName} locale (${localeItems.length} items)`,
          );
        }
      }
    } catch (error) {
      addError(
        "create",
        error instanceof Error ? error.message : "Failed to create items",
      );
      console.error(`   ❌ Create failed:`, error);
    }
  }

  // --- Step 4: Update existing items ---
  const updatedPrimaryIds: string[] = [];

  if (toUpdate.length > 0) {
    try {
      for (const locale of locales) {
        const dbLocale = mapWebflowTagToLocale(locale.tag);
        if (!dbLocale) {
          addError("update-locale", `No mapping for locale tag: ${locale.tag}`);
          continue;
        }

        const updateData = toUpdate
          .map((item) => {
            const itemId = existingMap.get(item.id);
            if (!itemId) {
              addError("update", "Item not found in Webflow", item.id);
              return;
            }

            return {
              ...defaultItemState,
              id: itemId,
              cmsLocaleId: locale.cmsLocaleId,
              fieldData: buildFieldData(item, dbLocale),
            };
          })
          .filter(Boolean) as WebflowItem[];

        if (updateData.length > 0) {
          await webflow.collections.items.updateItems(collection.id, {
            items: updateData,
          });
        }
      }

      updatedPrimaryIds.push(
        ...toUpdate.map((item) => existingMap.get(item.id)!),
      );
      result.updated = toUpdate.length;
      console.log(
        `   ✅ Updated ${toUpdate.length} ${entityName.toLowerCase()} across ${locales.length} locales`,
      );
    } catch (error) {
      addError(
        "update",
        error instanceof Error ? error.message : "Failed to update items",
      );
      console.error(`   ❌ Update failed:`, error);
    }
  }

  // --- Step 5: Publish all created/updated items ---
  const allIds = new Set([...createdPrimaryIds, ...updatedPrimaryIds]);

  if (allIds.size > 0) {
    try {
      await webflow.collections.items.publishItem(collection.id, {
        items: [...allIds].map((id) => ({ id, cmsLocaleIds: localeIds })),
      });
      result.published = allIds.size;
      console.log(`   ✅ Published ${allIds.size} items`);
    } catch (error) {
      addError(
        "publish",
        error instanceof Error ? error.message : "Failed to publish items",
      );
      console.error(`   ❌ Publish failed:`, error);
    }
  }

  // --- Summary ---
  result.duration = Date.now() - startTime;
  const hasErrors = result.errors.length > 0;

  console.log(
    `\n${hasErrors ? "⚠️" : "✅"} ${entityName} sync complete in ${result.duration}ms`,
  );
  console.log(
    `   Created: ${result.created}, Updated: ${result.updated}, Published: ${result.published}`,
  );

  if (hasErrors) {
    console.log(`   Errors: ${result.errors.length}`);
    result.errors.forEach((e) => {
      console.log(
        `     - [${e.step}] ${e.message}${e.itemId ? ` (${e.itemId})` : ""}`,
      );
    });
  }

  return result;
}

/**
 * Build a mapping from database external IDs to Webflow item IDs.
 * Used for resolving references when syncing related collections.
 */
export async function getIdMap(
  collectionSlug: string,
): Promise<Map<string, string>> {
  const collection = await findCollectionBySlug(
    webflowConfig.siteId,
    collectionSlug,
  );
  if (!collection) {
    throw new Error(`${collectionSlug} collection not found`);
  }

  const primaryCmsLocaleId = await getPrimaryLocaleId();
  const items = await webflow.collections.items.listItems(collection.id, {
    cmsLocaleId: primaryCmsLocaleId,
  });

  const map = new Map<string, string>();
  for (const item of items.items ?? []) {
    const externalId = (item.fieldData as any)?.["external-id"];
    if (externalId && item.id) {
      map.set(externalId, item.id);
    }
  }

  return map;
}
