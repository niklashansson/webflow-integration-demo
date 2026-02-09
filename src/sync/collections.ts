import {
  webflowConfig,
  upsertCollection,
  publishSite,
} from "../webflow/client.js";
import {
  getCategoriesSchema,
  getCitiesSchema,
  getStudiosSchema,
} from "../webflow/schemas.js";
import { webflow } from "../webflow/client.js";

type SetupResult = {
  success: boolean;
  collections: Record<string, { id: string; displayName: string }>;
  warnings: string[];
  errors: string[];
};

// Check if collection fields match schema and warn about mismatches
async function validateCollectionFields(
  collectionId: string,
  expectedFields: { id?: string }[],
  collectionName: string,
) {
  const collection = await webflow.collections.get(collectionId);
  const existingFieldSlugs = new Set(
    (collection.fields ?? []).map((f) => f.slug),
  );
  const expectedFieldIds = expectedFields.map((f) => f.id).filter(Boolean);
  const warnings: string[] = [];

  // Check for missing fields
  for (const fieldId of expectedFieldIds) {
    if (!existingFieldSlugs.has(fieldId!)) {
      warnings.push(
        `${collectionName}: Missing field "${fieldId}" - add it manually in Webflow`,
      );
    }
  }

  return warnings;
}

/**
 * Sync all collections to Webflow
 * - Creates collections if they don't exist
 * - Warns about missing fields (doesn't auto-create)
 * Order: Categories → Cities → Studios (dependencies)
 */
export async function syncCollections(): Promise<SetupResult> {
  console.log("🚀 Starting collection sync...\n");

  const result: SetupResult = {
    success: true,
    collections: {},
    warnings: [],
    errors: [],
  };

  try {
    // Step 1: Categories
    console.log("📁 Syncing Categories collection...");
    const categoriesSchema = getCategoriesSchema();
    const categories = await upsertCollection(
      webflowConfig.siteId,
      categoriesSchema,
    );
    if (!categories.id) throw new Error("Failed to sync Categories collection");
    result.collections.categories = {
      id: categories.id,
      displayName: categories.displayName ?? "Categories",
    };
    result.warnings.push(
      ...(await validateCollectionFields(
        categories.id,
        categoriesSchema.fields,
        "Categories",
      )),
    );

    // Step 2: Cities
    console.log("📁 Syncing Cities collection...");
    const citiesSchema = getCitiesSchema();
    const cities = await upsertCollection(webflowConfig.siteId, citiesSchema);
    if (!cities.id) throw new Error("Failed to sync Cities collection");
    result.collections.cities = {
      id: cities.id,
      displayName: cities.displayName ?? "Cities",
    };
    result.warnings.push(
      ...(await validateCollectionFields(
        cities.id,
        citiesSchema.fields,
        "Cities",
      )),
    );

    // Step 3: Studios (depends on Categories and Cities)
    console.log("📁 Syncing Studios collection...");
    const studiosSchema = getStudiosSchema(categories.id, cities.id);
    const studios = await upsertCollection(webflowConfig.siteId, studiosSchema);
    if (!studios.id) throw new Error("Failed to sync Studios collection");
    result.collections.studios = {
      id: studios.id,
      displayName: studios.displayName ?? "Studios",
    };
    result.warnings.push(
      ...(await validateCollectionFields(
        studios.id,
        studiosSchema.fields,
        "Studios",
      )),
    );

    // Log warnings
    if (result.warnings.length > 0) {
      console.log("\n⚠️ Schema warnings:");
      result.warnings.forEach((w) => console.log(`   ${w}`));
    }

    // Step 4: Publish
    console.log("\n🌐 Publishing site...");
    const publishResult = await publishSite();
    console.log(
      `   ✅ Published to ${publishResult.publishedDomains.length} domain(s)\n`,
    );

    console.log("🎉 Collection sync complete!");
    console.log(`   Categories: ${categories.id}`);
    console.log(`   Cities: ${cities.id}`);
    console.log(`   Studios: ${studios.id}`);
  } catch (error) {
    result.success = false;
    result.errors.push(
      error instanceof Error ? error.message : "Unknown error",
    );
    console.error("❌ Sync failed:", result.errors[0]);
  }

  return result;
}
