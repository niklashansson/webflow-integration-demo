import {
  webflow,
  webflowConfig,
  schedule,
  clearCollectionCache,
} from "../webflow/client.js";
import {
  categoriesSchema,
  citiesSchema,
  getStudiosSchema,
} from "../webflow/schemas.js";
import {
  syncCollectionSchema,
  validateCollectionSchema,
  type SchemaSyncResult,
} from "../utils/schema.js";

export type CollectionSyncAllResult = {
  categories: SchemaSyncResult;
  cities: SchemaSyncResult;
  studios: SchemaSyncResult;
  totalDuration: number;
};

export type CollectionValidationResult = {
  categories: Awaited<ReturnType<typeof validateCollectionSchema>>;
  cities: Awaited<ReturnType<typeof validateCollectionSchema>>;
  studios: Awaited<ReturnType<typeof validateCollectionSchema>>;
  allValid: boolean;
};

/**
 * Sync all collection schemas in dependency order.
 *
 * Order matters because Studios references Categories and Cities,
 * so those collections (and their IDs) must exist first.
 *
 * Pipeline:
 *  1. Sync Categories + Cities in parallel (independent)
 *  2. Sync Studios (needs category + city collection IDs for references)
 *
 * This is idempotent — running it multiple times converges to
 * the same state. Safe to call on every deploy.
 */
export async function syncAllCollectionSchemas(): Promise<CollectionSyncAllResult> {
  const startTime = Date.now();

  console.log("📐 Syncing collection schemas...\n");

  // Step 1: Sync Categories & Cities in parallel
  console.log("📁 Categories:");
  const categoriesResult = await syncCollectionSchema(
    categoriesSchema,
    webflowConfig.siteId,
    webflow,
    schedule,
  );

  console.log("📁 Cities:");
  const citiesResult = await syncCollectionSchema(
    citiesSchema,
    webflowConfig.siteId,
    webflow,
    schedule,
  );

  // Step 2: Sync Studios (needs the resolved collection IDs)
  const studiosSchema = getStudiosSchema(
    categoriesResult.collectionId,
    citiesResult.collectionId,
  );

  console.log("📁 Studios:");
  const studiosResult = await syncCollectionSchema(
    studiosSchema,
    webflowConfig.siteId,
    webflow,
    schedule,
  );

  const totalDuration = Date.now() - startTime;

  // Summary
  const totalCreated =
    categoriesResult.fieldsCreated.length +
    citiesResult.fieldsCreated.length +
    studiosResult.fieldsCreated.length;
  const totalRemoved =
    categoriesResult.fieldsRemoved.length +
    citiesResult.fieldsRemoved.length +
    studiosResult.fieldsRemoved.length;
  const totalMismatches =
    categoriesResult.typeMismatches.length +
    citiesResult.typeMismatches.length +
    studiosResult.typeMismatches.length;

  console.log(`\n✅ Schema sync complete in ${totalDuration}ms`);
  console.log(
    `   ${totalCreated} fields created, ${totalRemoved} removed, ${totalMismatches} type mismatches`,
  );

  // Clear cached collection resolution so next data sync picks up changes
  clearCollectionCache();

  return {
    categories: categoriesResult,
    cities: citiesResult,
    studios: studiosResult,
    totalDuration,
  };
}

/**
 * Validate all collection schemas against their current Webflow state.
 * Does NOT make any changes — purely a diagnostic tool.
 *
 * Looks up collections by slug — handles missing collections gracefully.
 */
export async function validateAllCollectionSchemas(): Promise<CollectionValidationResult> {
  console.log("🔍 Validating collection schemas...\n");

  const categoriesValidation = await validateCollectionSchema(
    categoriesSchema,
    webflowConfig.siteId,
    webflow,
    schedule,
  );

  const citiesValidation = await validateCollectionSchema(
    citiesSchema,
    webflowConfig.siteId,
    webflow,
    schedule,
  );

  const studiosSchema = getStudiosSchema(
    categoriesValidation.collectionId ?? "",
    citiesValidation.collectionId ?? "",
  );

  const studiosValidation = await validateCollectionSchema(
    studiosSchema,
    webflowConfig.siteId,
    webflow,
    schedule,
  );

  const allValid =
    categoriesValidation.valid &&
    citiesValidation.valid &&
    studiosValidation.valid;

  // Log results
  for (const [name, result] of Object.entries({
    Categories: categoriesValidation,
    Cities: citiesValidation,
    Studios: studiosValidation,
  })) {
    if (!result.exists) {
      console.log(`❌ ${name}: Collection not found — run schema sync first`);
      continue;
    }
    const icon = result.valid ? "✅" : "❌";
    console.log(`${icon} ${name}:`);
    if (result.missingFields.length > 0)
      console.log(`   Missing: ${result.missingFields.join(", ")}`);
    if (result.extraFields.length > 0)
      console.log(`   Extra: ${result.extraFields.join(", ")}`);
    if (result.typeMismatches.length > 0)
      console.log(`   Type mismatches: ${result.typeMismatches.join(", ")}`);
    if (result.slugRemaps.length > 0)
      console.log(
        `   Slug remaps: ${result.slugRemaps.map((r) => `${r.desired} → ${r.actual}`).join(", ")}`,
      );
    if (result.valid && result.extraFields.length === 0)
      console.log(`   All fields match schema`);
  }

  return {
    categories: categoriesValidation,
    cities: citiesValidation,
    studios: studiosValidation,
    allValid,
  };
}
