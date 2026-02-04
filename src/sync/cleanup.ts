import { webflow, config, findCollectionBySlug } from "../webflow/client.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type CleanupResult = {
  deleted: number;
  deletedIds: string[];
  errors: string[];
};

// Get all external IDs from a Webflow collection
async function getWebflowExternalIds(collectionId: string) {
  const items = await webflow.collections.items.listItems(collectionId);
  const map = new Map<string, string>();

  for (const item of items.items ?? []) {
    const externalId = (item.fieldData as any)?.["external-id"];
    if (externalId && item.id) map.set(externalId, item.id);
  }

  return map;
}

// Delete items from a Webflow collection that no longer exist in the database
export async function cleanupDeletedItems(
  collectionSlug: string,
  dbExternalIds: Set<string>,
): Promise<CleanupResult> {
  const result: CleanupResult = { deleted: 0, deletedIds: [], errors: [] };

  const collection = await findCollectionBySlug(config.siteId, collectionSlug);
  if (!collection) {
    result.errors.push(`Collection "${collectionSlug}" not found`);
    return result;
  }

  const webflowItems = await getWebflowExternalIds(collection.id);

  const itemsToDelete: { externalId: string; webflowId: string }[] = [];
  for (const [externalId, webflowId] of webflowItems) {
    if (!dbExternalIds.has(externalId)) {
      itemsToDelete.push({ externalId, webflowId });
    }
  }

  if (itemsToDelete.length === 0) {
    console.log(`   ✅ No orphaned items in ${collectionSlug}`);
    return result;
  }

  console.log(
    `   🗑️ Found ${itemsToDelete.length} orphaned item(s) in ${collectionSlug}`,
  );

  for (const { externalId, webflowId } of itemsToDelete) {
    try {
      await webflow.collections.items.deleteItem(collection.id, webflowId);
      result.deleted++;
      result.deletedIds.push(externalId);
      console.log(`   ✅ Deleted: ${externalId}`);
      await sleep(500);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Failed to delete ${externalId}: ${errorMsg}`);
      console.error(`   ❌ Failed to delete ${externalId}:`, errorMsg);
    }
  }

  return result;
}

/**
 * Cleanup all collections - delete in reverse dependency order:
 * Studios → Cities → Categories
 */
export async function cleanupAllCollections(
  categoryIds: Set<string>,
  cityIds: Set<string>,
  studioIds: Set<string>,
) {
  console.log("🧹 Cleaning up orphaned items...\n");

  console.log("🏢 Cleaning Studios...");
  const studiosResult = await cleanupDeletedItems("studios", studioIds);

  console.log("🏙️ Cleaning Cities...");
  const citiesResult = await cleanupDeletedItems("cities", cityIds);

  console.log("📁 Cleaning Categories...");
  const categoriesResult = await cleanupDeletedItems("categories", categoryIds);

  const totalDeleted =
    categoriesResult.deleted + citiesResult.deleted + studiosResult.deleted;
  console.log(
    `\n🧹 Cleanup complete! Deleted ${totalDeleted} orphaned item(s)`,
  );

  return {
    categories: categoriesResult,
    cities: citiesResult,
    studios: studiosResult,
  };
}
