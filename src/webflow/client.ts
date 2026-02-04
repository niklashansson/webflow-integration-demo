import { configDotenv } from "dotenv";
import { WebflowClient } from "webflow-api";
import type {
  CollectionsCreateRequest,
  Domain,
} from "webflow-api/api/index.js";

configDotenv();

// Config
export const config = {
  accessToken: process.env.WEBFLOW_ACCESS_TOKEN!,
  siteId: process.env.WEBFLOW_SITE_ID!,
};

// Client
export const webflow = new WebflowClient({ accessToken: config.accessToken });

// ----- Collections -----

export async function listCollections(siteId?: string) {
  const data = await webflow.collections.list(siteId ?? config.siteId);
  return data.collections ?? [];
}

export async function findCollectionBySlug(siteId: string, slug: string) {
  const collections = await listCollections(siteId);
  return collections.find((c) => c.slug === slug);
}

export async function upsertCollection(
  siteId: string,
  details: Required<CollectionsCreateRequest>,
) {
  const existing = await findCollectionBySlug(siteId, details.slug);
  if (existing) {
    console.log(`   📦 Found existing: ${existing.displayName}`);
    return existing;
  }
  const collection = await webflow.collections.create(siteId, details);
  console.log(`   ✅ Created: ${collection.displayName}`);
  return collection;
}

// ----- Items -----

// Find item by external-id, or fallback to slug if not found
export async function getItemByExternalId(
  collectionId: string,
  externalId: string,
  slug?: string,
) {
  const items = await webflow.collections.items.listItems(collectionId);

  // First try to find by external-id
  const byExternalId = items.items?.find(
    (item: any) => item.fieldData?.["external-id"] === externalId,
  );
  if (byExternalId) return byExternalId;

  // Fallback: find by slug (handles manually created items)
  if (slug) {
    const bySlug = items.items?.find(
      (item: any) => item.fieldData?.slug === slug,
    );
    if (bySlug) {
      console.log(
        `   ⚠️ Found item by slug "${slug}" (will update external-id)`,
      );
      return bySlug;
    }
  }

  return undefined;
}

// ----- Site -----

export async function publishSite(): Promise<{
  success: boolean;
  publishedDomains: Domain[];
}> {
  console.log(`🚀 Publishing site...`);
  const result = await webflow.sites.publish(config.siteId, {
    customDomains: [],
    publishToWebflowSubdomain: true,
  });
  console.log(`✅ Site published`);
  return { success: true, publishedDomains: result.customDomains ?? [] };
}
