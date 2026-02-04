import {
  webflow,
  config,
  findCollectionBySlug,
  getItemByExternalId,
} from "../webflow/client.js";
import type { CategoryCollectionItem } from "../webflow/schemas.js";
import type { Category } from "../db/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sync a single category to Webflow CMS
export async function syncCategoryToWebflow(
  siteId: string,
  category: Category,
) {
  const collection = await findCollectionBySlug(siteId, "categories");
  if (!collection) throw new Error("Categories collection not found");

  const existingItem = await getItemByExternalId(
    collection.id,
    category.id,
    category.slug,
  );

  const fieldData: CategoryCollectionItem = {
    name: category.name,
    slug: category.slug,
    "external-id": category.id,
  };

  if (existingItem) {
    const updated = await webflow.collections.items.updateItemLive(
      collection.id,
      existingItem.id!,
      { fieldData },
    );
    console.log(`✅ Updated & published category: ${category.name}`);
    return { action: "updated", item: updated };
  } else {
    const created = await webflow.collections.items.createItemLive(
      collection.id,
      { fieldData },
    );
    console.log(`✅ Created & published category: ${category.name}`);
    return { action: "created", item: created };
  }
}

// Bulk sync all categories
export async function syncAllCategories(categories: Category[]) {
  const results = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [] as { categoryId: string; error: string }[],
  };

  for (const category of categories) {
    try {
      const result = await syncCategoryToWebflow(config.siteId, category);
      if (result.action === "created") results.created++;
      else results.updated++;
      await sleep(1000);
    } catch (error) {
      results.failed++;
      results.errors.push({
        categoryId: category.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      console.error(`❌ Failed to sync category ${category.id}:`, error);
    }
  }

  return results;
}
