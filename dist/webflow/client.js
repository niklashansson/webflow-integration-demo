import { configDotenv } from "dotenv";
import { WebflowClient } from "webflow-api";
import { withRateLimit } from "./rate-limiter.js";
configDotenv();
// ----- Environment Validation -----
/**
 * Get a required environment variable or throw an error.
 */
function getEnvVar(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
// Config with validated environment variables
export const webflowConfig = {
    accessToken: getEnvVar("WEBFLOW_ACCESS_TOKEN"),
    siteId: getEnvVar("WEBFLOW_SITE_ID"),
    collectionSlugs: {
        categories: getEnvVar("WEBFLOW_CATEGORIES_COLLECTION_SLUG"),
        cities: getEnvVar("WEBFLOW_CITIES_COLLECTION_SLUG"),
        studios: getEnvVar("WEBFLOW_STUDIOS_COLLECTION_SLUG"),
    },
};
// Client
export const webflow = new WebflowClient({
    accessToken: webflowConfig.accessToken,
});
// Cache for locale data with TTL
let cachedLocales = null;
let localeCacheTimestamp = 0;
const LOCALE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Check if locale cache is still valid.
 */
function isLocaleCacheValid() {
    return (cachedLocales !== null &&
        Date.now() - localeCacheTimestamp < LOCALE_CACHE_TTL_MS);
}
/**
 * Get all configured locales for the site.
 * Returns array of locales with primary locale first.
 * Results are cached with a 5-minute TTL.
 */
export async function getSiteLocales() {
    if (isLocaleCacheValid())
        return cachedLocales;
    const site = await withRateLimit(() => webflow.sites.get(webflowConfig.siteId));
    const locales = [];
    // Add primary locale first
    if (site.locales?.primary) {
        const primary = site.locales.primary;
        locales.push({
            id: primary.id,
            cmsLocaleId: primary.cmsLocaleId,
            tag: primary.tag,
            displayName: primary.displayName,
            isPrimary: true,
        });
    }
    // Add secondary locales
    for (const secondary of site.locales?.secondary ?? []) {
        if (secondary.enabled) {
            locales.push({
                id: secondary.id,
                cmsLocaleId: secondary.cmsLocaleId,
                tag: secondary.tag,
                displayName: secondary.displayName,
                isPrimary: false,
            });
        }
    }
    cachedLocales = locales;
    localeCacheTimestamp = Date.now();
    return locales;
}
/**
 * Get all CMS locale IDs (used when creating items across all locales)
 */
export async function getLocaleIds() {
    const locales = await getSiteLocales();
    return locales.map((l) => l.cmsLocaleId);
}
/**
 * Get the primary CMS locale ID
 */
export async function getPrimaryLocaleId() {
    const locales = await getSiteLocales();
    const primary = locales.find((l) => l.isPrimary);
    if (!primary)
        throw new Error("No primary locale configured");
    return primary.cmsLocaleId;
}
/**
 * Clear cached locale data (useful after site configuration changes)
 */
export function clearLocaleCache() {
    cachedLocales = null;
    localeCacheTimestamp = 0;
}
/**
 * Locale tag mapping from Webflow to our supported locales.
 * Add new locale mappings here as needed.
 */
const LOCALE_TAG_MAPPING = {
    // Swedish
    "sv-SE": "sv",
    sv: "sv",
    // English
    "en-US": "en",
    "en-GB": "en",
    en: "en",
};
/**
 * Maps Webflow locale tags to our supported locale keys.
 * Webflow uses tags like "sv-SE", "en-US", we use "sv", "en".
 */
export function mapWebflowTagToLocale(tag) {
    return LOCALE_TAG_MAPPING[tag] ?? null;
}
// ----- Collections -----
export async function listCollections(siteId) {
    const data = await withRateLimit(() => webflow.collections.list(siteId ?? webflowConfig.siteId));
    return data.collections ?? [];
}
export async function findCollectionBySlug(siteId, slug) {
    const collections = await listCollections(siteId);
    return collections.find((c) => c.slug === slug);
}
export async function upsertCollection(siteId, details) {
    const existing = await findCollectionBySlug(siteId, details.slug);
    if (existing) {
        console.log(`   📦 Found existing: ${existing.displayName}`);
        return existing;
    }
    const collection = await withRateLimit(() => webflow.collections.create(siteId, details));
    console.log(`   ✅ Created: ${collection.displayName}`);
    return collection;
}
// ----- Pagination Helper -----
/**
 * Fetch ALL items from a collection with automatic pagination.
 * Webflow API limits to 100 items per request, this fetches all pages.
 *
 * @param collectionId - The collection to fetch items from
 * @param cmsLocaleId - Optional locale ID to filter items
 * @returns Array of all items in the collection
 */
export async function getAllCollectionItems(collectionId, cmsLocaleId) {
    const allItems = [];
    let offset = 0;
    const limit = 100;
    while (true) {
        const response = await withRateLimit(() => webflow.collections.items.listItems(collectionId, {
            limit,
            offset,
            cmsLocaleId,
        }));
        const items = (response.items ?? []);
        allItems.push(...items);
        // Check if we've fetched all items
        const total = response.pagination?.total ?? items.length;
        if (allItems.length >= total || items.length === 0) {
            break;
        }
        offset += limit;
    }
    return allItems;
}
// ----- Site -----
export async function publishSite() {
    console.log(`🚀 Publishing site...`);
    const result = await withRateLimit(() => webflow.sites.publish(webflowConfig.siteId, {
        customDomains: [],
        publishToWebflowSubdomain: true,
    }));
    console.log(`✅ Site published`);
    return { success: true, publishedDomains: result.customDomains ?? [] };
}
