import type { WebflowClient } from "webflow-api";
import type { Scheduler } from "./webflow.js";
import { noopScheduler } from "./webflow.js";

/**
 * Webflow field types supported by the Collections API.
 * Reference and MultiReference require `metadata.collectionId`.
 * Option requires `metadata.options`.
 */
export type WebflowFieldType =
  | "Color"
  | "DateTime"
  | "Email"
  | "File"
  | "Image"
  | "Link"
  | "MultiImage"
  | "MultiReference"
  | "Number"
  | "Option"
  | "Phone"
  | "PlainText"
  | "Reference"
  | "RichText"
  | "Switch"
  | "VideoLink";

/**
 * A single field definition in a collection schema.
 *
 * `slug` is the identifier used in item field data (e.g. "external-id").
 * This is the *desired* slug — Webflow may append "-2", "-3" etc.
 * if a slug was previously used and deleted. The sync engine
 * handles this by matching on slug prefix.
 */
export type FieldSchema = {
  slug: string;
  displayName: string;
  type: WebflowFieldType;
  isRequired?: boolean;
  helpText?: string;
  /** Required for Reference/MultiReference (collectionId) and Option (options) */
  metadata?: {
    collectionId?: string;
    options?: { name: string; id?: string }[];
  };
};

/**
 * Full schema definition for a Webflow CMS collection.
 * This is the single source of truth — the sync engine
 * converges the remote collection to match this schema.
 */
export type CollectionSchema = {
  displayName: string;
  singularName: string;
  slug: string;
  fields: FieldSchema[];
};

/**
 * A field as returned by the Webflow GET Collection API.
 */
type WebflowRemoteField = {
  id: string;
  slug?: string;
  displayName: string;
  type: string;
  isRequired: boolean;
  isEditable?: boolean;
  helpText?: string;
};

/**
 * Result of a schema sync operation.
 */
export type SchemaSyncResult = {
  collectionId: string;
  created: boolean;
  fieldsCreated: string[];
  fieldsRemoved: string[];
  fieldsSkippedRemoval: string[];
  typeMismatches: string[];
  errors: string[];
};

/**
 * Fields that exist on every Webflow CMS collection and cannot be deleted.
 *
 * These are marked `isEditable: true` (you can change their displayName)
 * but the API will reject deletion attempts. We skip them when removing
 * unused fields to avoid unnecessary errors.
 */
const BUILT_IN_FIELD_SLUGS = new Set(["name", "slug"]);

/**
 * Match a desired slug against a remote slug.
 *
 * Webflow appends "-2", "-3" etc. to field slugs when a field with
 * that slug was previously created and deleted. For example, if you
 * delete a "category" field and recreate it, Webflow names it "category-2".
 *
 * This function matches:
 *  - "category" === "category"       → true  (exact match)
 *  - "category" === "category-2"     → true  (suffix variant)
 *  - "category" === "category-name"  → false (different field)
 *
 * The suffix pattern is strictly: desired slug + "-" + digits only.
 */
function slugMatches(desiredSlug: string, remoteSlug: string): boolean {
  if (desiredSlug === remoteSlug) return true;

  // Check for the "-N" suffix pattern (e.g. "category-2", "category-13")
  if (!remoteSlug.startsWith(desiredSlug + "-")) return false;
  const suffix = remoteSlug.slice(desiredSlug.length + 1);
  return /^\d+$/.test(suffix);
}

/**
 * Find the remote field that matches a desired slug.
 * Returns the remote field (which may have a "-2" suffix) or undefined.
 */
function findRemoteField(
  desiredSlug: string,
  remoteFields: WebflowRemoteField[],
): WebflowRemoteField | undefined {
  return remoteFields.find(
    (rf) => rf.slug !== undefined && slugMatches(desiredSlug, rf.slug),
  );
}

/**
 * Find a collection by its slug within a site.
 * Returns the collection ID or null if not found.
 */
async function findCollectionBySlug(
  siteId: string,
  slug: string,
  client: WebflowClient,
  schedule: Scheduler = noopScheduler,
): Promise<string | null> {
  const response = await schedule(() => client.collections.list(siteId));
  const collections = response.collections ?? [];
  const match = collections.find((c) => c.slug === slug);
  return match?.id ?? null;
}

/**
 * Synchronize a collection's schema to match the provided definition.
 *
 * Pipeline:
 *  1. Find or create the collection
 *  2. Fetch current fields from Webflow
 *  3. Create missing fields (handles "-N" slug suffix)
 *  4. Validate field types match
 *  5. Remove fields not in schema (skip built-in + referenced fields)
 *
 * This function is idempotent — safe to re-run on every deploy.
 */
export async function syncCollectionSchema(
  schema: CollectionSchema,
  siteId: string,
  client: WebflowClient,
  schedule: Scheduler = noopScheduler,
): Promise<SchemaSyncResult> {
  const result: SchemaSyncResult = {
    collectionId: "",
    created: false,
    fieldsCreated: [],
    fieldsRemoved: [],
    fieldsSkippedRemoval: [],
    typeMismatches: [],
    errors: [],
  };

  // ── Step 1: Find or create the collection ──

  let collectionId = await findCollectionBySlug(
    siteId,
    schema.slug,
    client,
    schedule,
  );

  if (!collectionId) {
    console.log(`   📁 Creating collection "${schema.displayName}"...`);
    try {
      const created = await schedule(() =>
        client.collections.create(siteId, {
          displayName: schema.displayName,
          singularName: schema.singularName,
          slug: schema.slug,
        }),
      );
      collectionId = created.id!;
      result.created = true;
    } catch (err) {
      result.errors.push(
        `Failed to create collection "${schema.slug}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return result;
    }
  }

  result.collectionId = collectionId;

  // ── Step 2: Fetch current fields from Webflow ──

  const collection = await schedule(() => client.collections.get(collectionId));
  const remoteFields: WebflowRemoteField[] = (collection.fields ?? []).map(
    (f) => ({
      id: f.id!,
      slug: f.slug,
      displayName: f.displayName!,
      type: f.type!,
      isRequired: f.isRequired ?? false,
      isEditable: f.isEditable,
      helpText: f.helpText,
    }),
  );

  // Track which desired slugs map to which remote slugs
  // This is needed so we know the actual slug to use in fieldData
  const slugMap = new Map<string, string>();

  // ── Step 3: Create missing fields ──

  for (const field of schema.fields) {
    const existing = findRemoteField(field.slug, remoteFields);

    if (existing) {
      // Field exists — record actual slug (might be "category-2" etc.)
      slugMap.set(field.slug, existing.slug ?? field.slug);

      // Validate type match
      if (existing.type.toLowerCase() !== field.type.toLowerCase()) {
        const msg =
          `Type mismatch for "${field.slug}": ` +
          `expected "${field.type}", got "${existing.type}". ` +
          `Field types cannot be changed via API — delete and recreate manually.`;
        result.typeMismatches.push(msg);
        console.warn(`   ⚠️ ${msg}`);
      }
    } else {
      // Field doesn't exist — create it
      console.log(
        `   ➕ Creating field "${field.displayName}" (${field.type})`,
      );
      try {
        const createPayload: Record<string, unknown> = {
          displayName: field.displayName,
          type: field.type,
          isRequired: field.isRequired ?? false,
        };
        if (field.helpText) createPayload.helpText = field.helpText;
        if (field.metadata) createPayload.metadata = field.metadata;

        const created = await schedule(() =>
          client.collections.fields.create(
            collectionId,
            createPayload as unknown as Parameters<
              typeof client.collections.fields.create
            >[1],
          ),
        );

        // The created field's slug might have a "-N" suffix
        const actualSlug = (created as { slug?: string }).slug ?? field.slug;
        slugMap.set(field.slug, actualSlug);

        if (actualSlug !== field.slug) {
          console.log(
            `   ℹ️ Field "${field.slug}" was created with slug "${actualSlug}" ` +
              `(Webflow appended suffix due to previously deleted field)`,
          );
        }

        result.fieldsCreated.push(actualSlug);
      } catch (err) {
        result.errors.push(
          `Failed to create field "${field.slug}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ── Step 4: Remove fields not in schema ──

  for (const remote of remoteFields) {
    if (!remote.slug) continue;

    // Skip non-editable fields (system-managed by Webflow)
    if (remote.isEditable === false) continue;

    // Skip built-in fields that are editable but cannot be deleted
    if (BUILT_IN_FIELD_SLUGS.has(remote.slug)) continue;

    // Check if this remote field matches any desired slug
    const isDesired = schema.fields.some((f) =>
      slugMatches(f.slug, remote.slug!),
    );

    if (!isDesired) {
      console.log(
        `   🗑️ Removing unused field "${remote.slug}" (${remote.type})`,
      );
      try {
        await schedule(() =>
          client.collections.fields.delete(collectionId, remote.id),
        );
        result.fieldsRemoved.push(remote.slug);
      } catch (err) {
        // Field deletion can fail if other collections reference it
        const msg = err instanceof Error ? err.message : String(err);
        result.fieldsSkippedRemoval.push(remote.slug);
        console.warn(
          `   ⚠️ Could not remove field "${remote.slug}": ${msg} ` +
            `(likely referenced by another collection)`,
        );
      }
    }
  }

  return result;
}

/**
 * Validate a collection's remote fields against a schema definition
 * WITHOUT making any changes. Useful for pre-flight checks.
 *
 * Looks up the collection by slug — returns `exists: false` if the
 * collection doesn't exist yet (no error thrown).
 *
 * Returns a report of:
 *  - Missing fields (in schema but not in Webflow)
 *  - Extra fields (in Webflow but not in schema)
 *  - Type mismatches (field exists but wrong type)
 *  - Slug remaps (field exists with "-N" suffix)
 */
export async function validateCollectionSchema(
  schema: CollectionSchema,
  siteId: string,
  client: WebflowClient,
  schedule: Scheduler = noopScheduler,
): Promise<{
  valid: boolean;
  exists: boolean;
  collectionId: string | null;
  missingFields: string[];
  extraFields: string[];
  typeMismatches: string[];
  slugRemaps: { desired: string; actual: string }[];
}> {
  // Look up collection by slug
  const collectionId = await findCollectionBySlug(
    siteId,
    schema.slug,
    client,
    schedule,
  );

  if (!collectionId) {
    return {
      valid: false,
      exists: false,
      collectionId: null,
      missingFields: schema.fields.map((f) => f.slug),
      extraFields: [],
      typeMismatches: [],
      slugRemaps: [],
    };
  }

  const collection = await schedule(() => client.collections.get(collectionId));
  const remoteFields: WebflowRemoteField[] = (collection.fields ?? []).map(
    (f) => ({
      id: f.id!,
      slug: f.slug,
      displayName: f.displayName!,
      type: f.type!,
      isRequired: f.isRequired ?? false,
      isEditable: f.isEditable,
    }),
  );

  const missingFields: string[] = [];
  const typeMismatches: string[] = [];
  const slugRemaps: { desired: string; actual: string }[] = [];

  for (const field of schema.fields) {
    const remote = findRemoteField(field.slug, remoteFields);
    if (!remote) {
      missingFields.push(field.slug);
    } else {
      if (remote.type.toLowerCase() !== field.type.toLowerCase()) {
        typeMismatches.push(
          `"${field.slug}": expected "${field.type}", got "${remote.type}"`,
        );
      }
      if (remote.slug !== field.slug) {
        slugRemaps.push({ desired: field.slug, actual: remote.slug! });
      }
    }
  }

  // Find extra fields (in Webflow but not in our schema)
  const extraFields: string[] = [];
  for (const remote of remoteFields) {
    if (!remote.slug) continue;
    if (remote.isEditable === false) continue;
    if (BUILT_IN_FIELD_SLUGS.has(remote.slug)) continue;

    const isDesired = schema.fields.some((f) =>
      slugMatches(f.slug, remote.slug!),
    );
    if (!isDesired) {
      extraFields.push(remote.slug);
    }
  }

  return {
    valid: missingFields.length === 0 && typeMismatches.length === 0,
    exists: true,
    collectionId,
    missingFields,
    extraFields,
    typeMismatches,
    slugRemaps,
  };
}

/**
 * Build a slug mapping for a collection: desired slug → actual remote slug.
 *
 * Use this when building fieldData so you write to the correct
 * field key (e.g. "category-2" instead of "category").
 */
export async function getFieldSlugMap(
  schema: CollectionSchema,
  collectionId: string,
  client: WebflowClient,
  schedule: Scheduler = noopScheduler,
): Promise<Map<string, string>> {
  const collection = await schedule(() => client.collections.get(collectionId));
  const remoteFields = (collection.fields ?? []).map((f) => ({
    slug: f.slug,
  }));

  const map = new Map<string, string>();
  for (const field of schema.fields) {
    const remote = remoteFields.find(
      (rf) => rf.slug !== undefined && slugMatches(field.slug, rf.slug),
    );
    map.set(field.slug, remote?.slug ?? field.slug);
  }
  return map;
}
