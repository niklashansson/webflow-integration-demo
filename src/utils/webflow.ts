import type { WebflowClient } from "webflow-api";
import type { CollectionItem, Locale } from "webflow-api/api/index.js";

/**
 * Locale-specific variant of a Webflow CMS item.
 * Each variant represents the same item in a different locale.
 */
export type LocalizedItem = {
  id: string;
  cmsLocaleId: string;
  fieldData: Record<string, unknown>;
};

/**
 * A Webflow CMS item grouped with all its locale variants.
 * `corrupted` is true when different locale variants within the same
 * Webflow item ID carry different values for the identifier field.
 */
export type ItemWithLocales = {
  id: string;
  variants: LocalizedItem[];
  corrupted: boolean;
};

/**
 * Enriched locale type with guaranteed id, tag, cmsLocaleId & isPrimary flag.
 */
export type EnrichedLocale = Locale &
  Required<Pick<Locale, "id" | "tag" | "cmsLocaleId">> & {
    isPrimary: boolean;
  };

/** Rate-limited scheduler — wraps every API call through the rate limiter */
export type Scheduler = <T>(fn: () => Promise<T>) => Promise<T>;

/** No-op scheduler when rate limiting is not needed (e.g. tests) */
export const noopScheduler: Scheduler = (fn) => fn();

/**
 * Fetch ALL items from a collection with automatic pagination.
 *
 * Webflow API limits response to 100 items per page. This function
 * walks through all pages until `pagination.total` is reached.
 *
 * When multiple locale IDs are passed the API returns one row per
 * locale variant. This function deduplicates by Webflow item ID so
 * the caller gets one entry per item (first occurrence wins).
 */
export async function fetchAllItems(
  collectionId: string,
  client: WebflowClient,
  cmsLocaleIds: string[],
  schedule: Scheduler = noopScheduler,
): Promise<CollectionItem[]> {
  const allItems: CollectionItem[] = [];
  let offset = 0;
  const limit = 100;

  // Webflow accepts multiple locale IDs as a comma-separated string
  const localeParam = cmsLocaleIds.join(",");

  while (true) {
    const response = await schedule(() =>
      client.collections.items.listItems(collectionId, {
        offset,
        limit,
        cmsLocaleId: localeParam,
      }),
    );

    const items = response.items ?? [];
    const total = response.pagination?.total ?? 0;

    for (const item of items) {
      allItems.push({ id: item.id, fieldData: item.fieldData });
    }

    offset += items.length;
    if (offset >= total || items.length === 0) break;
  }

  // Deduplicate when fetching from multiple locales
  if (cmsLocaleIds.length > 1) {
    const seen = new Set<string>();
    return allItems.filter((item) => {
      if (!item.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  return allItems;
}

/**
 * Data Discovery & Mapping utility.
 *
 * 1. Multi-Locale Fetch — fetches all items for ALL locales in a single
 *    paginated pass using comma-separated cmsLocaleId params.
 *
 * 2. Grouping — organizes the flat API response into `ItemWithLocales`
 *    structures grouped by Webflow item ID.
 *
 * 3. Identity Mapping — returns a `Map<string, ItemWithLocales[]>` where
 *    the key is the value of `identifierField` (e.g. "external-id").
 *    Multiple groups can exist for the same identifier when duplicates
 *    have been created in Webflow.
 *
 * 4. Validation — if locale variants within a single group have
 *    different identifier values the group is flagged as `corrupted`.
 */
export async function fetchAndMapItemsByIdentifier(
  collectionId: string,
  client: WebflowClient,
  cmsLocaleIds: string[],
  identifierField: string = "external-id",
  schedule: Scheduler = noopScheduler,
): Promise<Map<string, ItemWithLocales[]>> {
  // ── Step 1: Fetch all locale-variant rows ──
  const allRows: LocalizedItem[] = [];
  let offset = 0;
  const limit = 100;
  const localeParam = cmsLocaleIds.join(",");

  while (true) {
    const response = await schedule(() =>
      client.collections.items.listItems(collectionId, {
        offset,
        limit,
        cmsLocaleId: localeParam,
      }),
    );

    const items = response.items ?? [];
    const total = response.pagination?.total ?? 0;

    for (const item of items) {
      if (item.id && item.cmsLocaleId) {
        allRows.push({
          id: item.id,
          cmsLocaleId: item.cmsLocaleId,
          fieldData: item.fieldData,
        });
      }
    }

    offset += items.length;
    if (offset >= total || items.length === 0) break;
  }

  // ── Step 2: Group by Webflow item ID ──
  const grouped = new Map<string, LocalizedItem[]>();
  for (const row of allRows) {
    const existing = grouped.get(row.id);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.id, [row]);
    }
  }

  // ── Step 3 & 4: Build identity map & flag corruption ──
  const identityMap = new Map<string, ItemWithLocales[]>();

  for (const [webflowId, variants] of grouped) {
    // Collect all unique identifier values across variants
    const identifierValues = new Set(
      variants
        .map((v) => v.fieldData[identifierField] as string | undefined)
        .filter(Boolean),
    );

    // Flag as corrupted when variants disagree on the identifier
    const corrupted = identifierValues.size > 1;

    // Use the first non-empty identifier as the group key
    const primaryIdentifier = [...identifierValues][0];

    if (!primaryIdentifier) {
      // Item has no identifier at all — skip it (un-mappable)
      continue;
    }

    if (corrupted) {
      console.warn(
        `⚠️ Corrupted item ${webflowId}: locale variants have different ` +
          `"${identifierField}" values: ${[...identifierValues].join(", ")}`,
      );
    }

    const group: ItemWithLocales = { id: webflowId, variants, corrupted };
    const existing = identityMap.get(primaryIdentifier) ?? [];
    identityMap.set(primaryIdentifier, [...existing, group]);
  }

  return identityMap;
}

/**
 * Get all enabled locales for a site.
 * Returns the primary locale first, then secondary locales in order.
 * Throws if the site is missing a primary locale or any locale lacks
 * required fields (id, tag, cmsLocaleId).
 */
export async function getLocales(
  client: WebflowClient,
  siteId: string,
  schedule: Scheduler = noopScheduler,
): Promise<EnrichedLocale[]> {
  const site = await schedule(() => client.sites.get(siteId));
  const locales: Locale[] = [];

  if (!site.locales?.primary) {
    throw new Error("No primary locale found for site");
  }

  // Primary locale always comes first
  locales.push(site.locales.primary);

  // Add enabled secondary locales
  site.locales.secondary?.forEach((l) => l.enabled && locales.push(l));

  // Validate every locale has the required fields
  return locales.map((l) => {
    if (!l.id || !l.tag || !l.cmsLocaleId) {
      throw new Error("Invalid locale found — missing id, tag or cmsLocaleId");
    }

    return {
      id: l.id,
      tag: l.tag,
      cmsLocaleId: l.cmsLocaleId,
      isPrimary: l === site.locales?.primary,
    };
  });
}
