import { configDotenv } from "dotenv";
import { WebflowClient } from "webflow-api";
import { createRateLimiter } from "../utils/rate-limiter.js";
import { getFieldSlugMap } from "../utils/schema.js";
import { categoriesSchema, citiesSchema, getStudiosSchema } from "./schemas.js";

configDotenv();

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Only two env vars needed — collection IDs are resolved by slug
export const webflowConfig = {
  accessToken: getEnvVar("WEBFLOW_ACCESS_TOKEN"),
  siteId: getEnvVar("WEBFLOW_SITE_ID"),
};

// Initialize the Webflow client
export const webflow = new WebflowClient({
  accessToken: webflowConfig.accessToken,
});

// Shared rate-limited scheduler for all API calls (60 req/min)
export const schedule = createRateLimiter();

// Resolved lazily on first access and cached for the process lifetime.

type ResolvedCollections = {
  categories: { id: string; slugMap: Map<string, string> };
  cities: { id: string; slugMap: Map<string, string> };
  studios: { id: string; slugMap: Map<string, string> };
};

let _cached: ResolvedCollections | null = null;

/**
 * Resolve all collection IDs and field slug maps by looking up
 * collections via their schema-defined slugs.
 *
 * Cached after first call — safe to call from anywhere without
 * worrying about extra API calls.
 */
export async function resolveCollections(): Promise<ResolvedCollections> {
  if (_cached) return _cached;

  // Find collection IDs by slug (one API call — lists all collections)
  const response = await schedule(() =>
    webflow.collections.list(webflowConfig.siteId),
  );
  const collections = response.collections ?? [];

  function findId(slug: string): string {
    const match = collections.find((c) => c.slug === slug);
    if (!match?.id) {
      throw new Error(
        `Collection "${slug}" not found in Webflow. Run schema sync first (POST /api/sync/collections).`,
      );
    }
    return match.id;
  }

  const categoriesId = findId(categoriesSchema.slug);
  const citiesId = findId(citiesSchema.slug);
  const studiosId = findId(getStudiosSchema(categoriesId, citiesId).slug);

  // Resolve slug maps in parallel (3 API calls)
  const [catSlugs, citySlugs, studioSlugs] = await Promise.all([
    getFieldSlugMap(categoriesSchema, categoriesId, webflow, schedule),
    getFieldSlugMap(citiesSchema, citiesId, webflow, schedule),
    getFieldSlugMap(
      getStudiosSchema(categoriesId, citiesId),
      studiosId,
      webflow,
      schedule,
    ),
  ]);

  _cached = {
    categories: { id: categoriesId, slugMap: catSlugs },
    cities: { id: citiesId, slugMap: citySlugs },
    studios: { id: studiosId, slugMap: studioSlugs },
  };

  return _cached;
}

/**
 * Clear the cached collection resolution.
 * Call after schema sync to force re-resolution on next data sync.
 */
export function clearCollectionCache(): void {
  _cached = null;
}
