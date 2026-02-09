import { configDotenv } from "dotenv";
import { WebflowClient } from "webflow-api";
import type {
  CollectionsCreateRequest,
  Domain,
  Locale,
} from "webflow-api/api/index.js";
import type { SupportedLocale } from "../db/index.js";

configDotenv();

// Config
export const webflowConfig = {
  accessToken: process.env.WEBFLOW_ACCESS_TOKEN!,
  siteId: process.env.WEBFLOW_SITE_ID!,
  collectionSlugs: {
    categories: process.env.WEBFLOW_CATEGORIES_COLLECTION_SLUG!,
    cities: process.env.WEBFLOW_CITIES_COLLECTION_SLUG!,
    studios: process.env.WEBFLOW_STUDIOS_COLLECTION_SLUG!,
  },
};

// Client
export const webflow = new WebflowClient({
  accessToken: webflowConfig.accessToken,
});

// ----- Locales -----

export type WebflowLocale = {
  id: string;
  cmsLocaleId: string;
  tag: string; // e.g., "sv-SE", "nb-NO"
  displayName: string;
  isPrimary: boolean;
};

// Cache for locale data to avoid repeated API calls
let cachedLocales: WebflowLocale[] | null = null;

/**
 * Get all configured locales for the site.
 * Returns array of locales with primary locale first.
 */
export async function getSiteLocales(): Promise<WebflowLocale[]> {
  if (cachedLocales) return cachedLocales;

  const site = await webflow.sites.get(webflowConfig.siteId);
  const locales: WebflowLocale[] = [];

  // Add primary locale first
  if (site.locales?.primary) {
    const primary = site.locales.primary;
    locales.push({
      id: primary.id!,
      cmsLocaleId: primary.cmsLocaleId!,
      tag: primary.tag!,
      displayName: primary.displayName!,
      isPrimary: true,
    });
  }

  // Add secondary locales
  for (const secondary of site.locales?.secondary ?? []) {
    if (secondary.enabled) {
      locales.push({
        id: secondary.id!,
        cmsLocaleId: secondary.cmsLocaleId!,
        tag: secondary.tag!,
        displayName: secondary.displayName!,
        isPrimary: false,
      });
    }
  }

  cachedLocales = locales;
  return locales;
}

/**
 * Get all CMS locale IDs (used when creating items across all locales)
 */
export async function getLocaleIds(): Promise<string[]> {
  const locales = await getSiteLocales();
  return locales.map((l) => l.cmsLocaleId);
}

/**
 * Get the primary CMS locale ID
 */
export async function getPrimaryLocaleId(): Promise<string> {
  const locales = await getSiteLocales();
  const primary = locales.find((l) => l.isPrimary);
  if (!primary) throw new Error("No primary locale configured");
  return primary.cmsLocaleId;
}

/**
 * Clear cached locale data (useful after site configuration changes)
 */
export function clearLocaleCache(): void {
  cachedLocales = null;
}

/**
 * Maps Webflow locale tags to our supported locale keys.
 * Webflow uses tags like "sv-SE", "nb-NO", we use "sv", "no".
 */
export function mapWebflowTagToLocale(tag: string): SupportedLocale | null {
  const mapping: Record<string, SupportedLocale> = {
    "sv-SE": "sv",
    sv: "sv",
    "en-US": "en",
    en: "en",
  };
  return mapping[tag] ?? null;
}

// ----- Collections -----

export async function listCollections(siteId?: string) {
  const data = await webflow.collections.list(siteId ?? webflowConfig.siteId);
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
  cmsLocaleId?: string,
) {
  const items = await webflow.collections.items.listItems(collectionId, {
    cmsLocaleId,
  });

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
  const result = await webflow.sites.publish(webflowConfig.siteId, {
    customDomains: [],
    publishToWebflowSubdomain: true,
  });
  console.log(`✅ Site published`);
  return { success: true, publishedDomains: result.customDomains ?? [] };
}
