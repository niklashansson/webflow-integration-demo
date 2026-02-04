import { webflow, config, findCollectionBySlug, getItemByExternalId, } from "../webflow/client.js";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sync a single city to Webflow CMS
export async function syncCityToWebflow(siteId, city) {
    const collection = await findCollectionBySlug(siteId, "cities");
    if (!collection)
        throw new Error("Cities collection not found");
    const existingItem = await getItemByExternalId(collection.id, city.id, city.slug);
    const fieldData = {
        name: city.name,
        slug: city.slug,
        "external-id": city.id,
    };
    if (existingItem) {
        const updated = await webflow.collections.items.updateItemLive(collection.id, existingItem.id, { fieldData });
        console.log(`✅ Updated & published city: ${city.name}`);
        return { action: "updated", item: updated };
    }
    else {
        const created = await webflow.collections.items.createItemLive(collection.id, { fieldData });
        console.log(`✅ Created & published city: ${city.name}`);
        return { action: "created", item: created };
    }
}
// Bulk sync all cities
export async function syncAllCities(cities) {
    const results = {
        created: 0,
        updated: 0,
        failed: 0,
        errors: [],
    };
    for (const city of cities) {
        try {
            const result = await syncCityToWebflow(config.siteId, city);
            if (result.action === "created")
                results.created++;
            else
                results.updated++;
            await sleep(1000);
        }
        catch (error) {
            results.failed++;
            results.errors.push({
                cityId: city.id,
                error: error instanceof Error ? error.message : "Unknown error",
            });
            console.error(`❌ Failed to sync city ${city.id}:`, error);
        }
    }
    return results;
}
