import {
  webflow,
  findCollectionBySlug,
  getItemByExternalId,
} from "../webflow/client.js";
import type { StudioCollectionItem } from "../webflow/schemas.js";
import type { Studio } from "../db/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Sync a single studio to Webflow CMS
export async function syncStudioToWebflow(
  siteId: string,
  studio: Studio,
  categoryIdMap?: Map<string, string>,
  cityIdMap?: Map<string, string>,
) {
  const collection = await findCollectionBySlug(siteId, "studios");
  if (!collection) throw new Error("Studios collection not found");

  const existingItem = await getItemByExternalId(
    collection.id,
    studio.id,
    studio.slug,
  );

  // Resolve references
  const webflowCategoryIds: string[] = [];
  if (categoryIdMap && studio.categoryIds) {
    for (const catId of studio.categoryIds) {
      const webflowId = categoryIdMap.get(catId);
      if (webflowId) webflowCategoryIds.push(webflowId);
    }
  }
  const webflowCityId = cityIdMap?.get(studio.city);

  const fieldData: StudioCollectionItem = {
    name: studio.name,
    slug: studio.slug,
    address: studio.address,
    city: webflowCityId,
    description: studio.description ?? undefined,
    latitude: studio.lat ?? undefined,
    longitude: studio.lng ?? undefined,
    "external-id": studio.id,
    "hero-image": studio.heroImageUrl ?? undefined,
    categories: webflowCategoryIds,
  };

  if (existingItem) {
    const updated = await webflow.collections.items.updateItemLive(
      collection.id,
      existingItem.id!,
      { fieldData },
    );
    console.log(`✅ Updated & published studio: ${studio.name}`);
    return { action: "updated", item: updated };
  } else {
    const created = await webflow.collections.items.createItemLive(
      collection.id,
      { fieldData },
    );
    console.log(`✅ Created & published studio: ${studio.name}`);
    return { action: "created", item: created };
  }
}

// Bulk sync all studios
export async function syncAllStudios(
  siteId: string,
  studios: Studio[],
  categoryIdMap?: Map<string, string>,
  cityIdMap?: Map<string, string>,
) {
  const results = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [] as { studioId: string; error: string }[],
  };

  for (const studio of studios) {
    try {
      const result = await syncStudioToWebflow(
        siteId,
        studio,
        categoryIdMap,
        cityIdMap,
      );
      if (result.action === "created") results.created++;
      else results.updated++;
      await sleep(1000);
    } catch (error) {
      results.failed++;
      results.errors.push({
        studioId: studio.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      console.error(`❌ Failed to sync studio ${studio.id}:`, error);
    }
  }

  return results;
}
