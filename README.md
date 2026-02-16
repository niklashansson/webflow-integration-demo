# Webflow CMS Sync

An idempotent sync engine that pushes structured, multi-locale data into Webflow CMS collections via the Data API v2. Built with Hono, TypeScript, and the official `webflow-api` SDK.

## Why This Exists

Webflow CMS is great for content-driven sites, but managing it programmatically has sharp edges. This project solves the common scenario: **you have structured data (JSON, database, etc.) and want to keep Webflow CMS in sync with it automatically**.

## Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment variables (see below)
cp .env.example .env

# Run the dev server
pnpm dev
```

### Environment Variables

```env
WEBFLOW_ACCESS_TOKEN=   # API token from Webflow dashboard → Site Settings → Apps & Integrations
WEBFLOW_SITE_ID=        # Site ID from Webflow Dashboard → Site Settings → General
```

> That's it — collection IDs are resolved automatically by matching schema-defined slugs against your Webflow site.

---

## Webflow CMS Concepts

A few things about the Webflow CMS API that aren't obvious:

### Collections & Fields

- A **Collection** is like a database table (e.g. "Studios", "Categories").
- Each collection has **fields** (columns) with a `slug`, `displayName`, and `type`.
- Every collection comes with built-in fields: `name`, `slug`, `_archived`, `_draft`, etc. These can't be deleted.
- Field types include `PlainText`, `RichText`, `Image`, `Number`, `Reference`, `MultiReference`, etc.

### The `-2` Slug Problem

When you delete a Webflow field and recreate it with the same name, Webflow doesn't reuse the old slug. Instead it appends `-2`, `-3`, etc:

```
"latitude" → delete → recreate → "latitude-2"
```

This is permanent — you can't rename the slug back. The sync engine handles this automatically by matching fields using a pattern (`latitude` matches `latitude-2`) and resolving the actual slug before sending data.

### Locales

Webflow supports multi-locale sites. Each CMS item has one variant per locale, all sharing the same Webflow item ID. Important details:

- **Create**: pass `cmsLocaleIds` to create variants for all locales in one call.
- **Update**: each locale variant is a separate entry in the update payload (`{ id, cmsLocaleId, fieldData }`).
- **Delete/Publish**: you **must** pass `cmsLocaleIds` explicitly. Without it, Webflow only affects the primary locale — secondary locale variants and their slugs persist as ghosts.
- **Slug in updates**: don't send `slug` in update payloads. Webflow validates slug uniqueness across all entries in the batch, so sending the same slug for multiple locale variants of the same item causes a conflict.

### References

- **Reference** (single): stores one Webflow item ID linking to another collection.
- **MultiReference**: stores an array of Webflow item IDs.
- Both require the target collection's **collection ID** at field creation time.
- When syncing data, you need to resolve your local IDs (e.g. `"city-stockholm"`) to Webflow item IDs (e.g. `"507f1f77bcf86cd799439011"`). This is why categories and cities must be synced before studios.

### Rate Limits

Webflow enforces **60 requests per minute** per API token. The sync engine uses a token-bucket rate limiter with 1050ms minimum spacing between requests. All API calls flow through a shared scheduler — no manual throttling needed.

### Publishing

Items created via the API start as **staged** (draft). You must explicitly publish them. If the Webflow site itself has never been published, the publish API returns a `409 Conflict` — the engine detects this and skips publishing with a warning instead of failing.

---

## Architecture

```
src/
├── index.ts              # Hono API server — HTTP endpoints
├── types.ts              # Shared types (SyncResult, SyncOptions, etc.)
├── db/                   # Source data (JSON files + typed accessors)
│   ├── index.ts          # Type definitions & data exports
│   ├── categories.json
│   ├── cities.json
│   └── studios.json
├── webflow/
│   ├── client.ts         # Webflow client, config, collection resolver + cache
│   └── schemas.ts        # Collection schemas (single source of truth)
├── sync/
│   ├── index.ts          # Full pipeline orchestrator (syncAll)
│   ├── categories.ts     # Category-specific sync logic
│   ├── cities.ts         # City-specific sync logic
│   ├── studios.ts        # Studio-specific sync logic (with references)
│   ├── cleanup.ts        # Orphan removal + reference cleanup
│   └── collections.ts    # Schema sync + validation
└── utils/
    ├── sync.ts           # Generic sync engine (syncCollection)
    ├── schema.ts         # Schema sync engine (field creation/removal/validation)
    ├── batch.ts          # Batch operations (create, update, delete, publish)
    ├── cleanup.ts        # Cleanup utilities (orphan detection, reference removal)
    ├── webflow.ts        # Low-level Webflow helpers (fetch items, locales)
    ├── rate-limiter.ts   # Token-bucket rate limiter
    └── locales.ts        # Webflow locale tag → app locale mapping
```

### Two-Phase Sync

The sync runs in two distinct phases:

**Phase 1: Schema Sync** (`POST /api/sync/collections`)

Creates collections and fields in Webflow from code-defined schemas. Run this once on setup or when you change the schema.

```
schemas.ts → syncCollectionSchema() → Webflow collections exist with correct fields
```

**Phase 2: Data Sync** (`POST /api/sync/all`)

Pushes your source data into the collections. Safe to run repeatedly — the engine is idempotent.

```
db/*.json → syncCollection() → items created/updated/deleted in Webflow
```

---

## Sync Engine

The core engine (`syncCollection` in `utils/sync.ts`) follows this pipeline for each collection:

```
0. Pre-flight    Validate schema if provided (abort on missing fields)
1. Discover      Fetch all existing Webflow items across all locales
2. Categorize    Compare local → remote:
                   • toCreate — item not in Webflow
                   • toRecreate — item exists but missing locale variants
                   • toUpdate — item exists with all locales
                   • toDelete — orphans, corrupted, duplicates
3. Delete        Remove orphans + corrupted + incomplete items
4. Create        POST new items with all locale variants
5. Re-fetch      Get definitive Webflow IDs (handles creates + ghost items)
6. Update        PATCH every item × every locale (staged)
7. Publish       Batch-publish all items across all locales
```

### Self-Healing

The engine converges to the correct state regardless of the current Webflow state. It handles:

- Items created manually in the Webflow Designer
- Items an editor accidentally drafted or unpublished
- Partially failed previous syncs (ghost items)
- Corrupted items (locale variants with different identifier values)
- Duplicate items (multiple Webflow items for the same external ID)

### Pre-flight Validation

When a `schema` is provided in `SyncOptions`, the engine validates that all required fields exist in Webflow before sending any data. If fields are missing or types don't match, it aborts early with a clear error:

```
[general] Missing fields in Webflow: latitude, longitude. Run schema sync first to create them.
```

---

## Cleanup

Cleanup runs after data sync and handles deletions in dependency order:

1. **Delete orphaned Studios** (nothing references Studios)
2. **Remove references** from remaining Studios that point to Cities/Categories being deleted
3. **Delete orphaned Cities**
4. **Delete orphaned Categories**

Step 2 is critical — Webflow won't let you delete an item that's still referenced by another item.

The delete itself uses a **double-delete pattern**:

1. `deleteItemsLive` — unpublish from all locales
2. `deleteItems` — permanently delete from all locales

Without this, secondary locale variant slugs persist as ghost entries.

---

## API Endpoints

| Method | Path                        | Description                                 |
| ------ | --------------------------- | ------------------------------------------- |
| `POST` | `/api/sync/collections`     | Create/update collection schemas in Webflow |
| `GET`  | `/api/validate/collections` | Validate schemas without making changes     |
| `POST` | `/api/sync/all`             | Full pipeline: sync all data + cleanup      |
| `POST` | `/api/sync/categories`      | Sync categories only                        |
| `POST` | `/api/sync/cities`          | Sync cities only                            |
| `POST` | `/api/sync/studios`         | Sync studios only                           |
| `POST` | `/api/cleanup/all`          | Remove orphaned items                       |
| `GET`  | `/health`                   | Health check                                |

### Typical first-time setup

```bash
# 1. Sync schemas (creates collections + fields)
curl -X POST http://localhost:3000/api/sync/collections

# 2. Sync all data (collection IDs are resolved automatically)
curl -X POST http://localhost:3000/api/sync/all
```

---

## Adding a New Collection

1. **Define the schema** in `webflow/schemas.ts`:

```typescript
export const productsSchema: CollectionSchema = {
  displayName: "Products",
  singularName: "Product",
  slug: "products",
  fields: [
    {
      slug: "external-id",
      displayName: "External ID",
      type: "PlainText",
      isRequired: true,
    },
    { slug: "price", displayName: "Price", type: "Number" },
  ],
};
```

2. **Add source data** in `db/` with typed exports.

3. **Create a sync function** in `sync/` following the pattern in `categories.ts`:

```typescript
export async function syncProductsToWebflow(products: Product[]) {
  const cols = await resolveCollections();
  const s = (desired: string) => cols.products.slugMap.get(desired) ?? desired;

  return syncCollection(
    {
      collectionId: cols.products.id,
      siteId: webflowConfig.siteId,
      items: products,
      schema: productsSchema,
      identifierField: s("external-id"),
      buildFieldData: (item, localeTag) => ({
        name: item.name,
        slug: item.slug,
        [s("external-id")]: item.id,
        [s("price")]: item.price,
      }),
    },
    webflow,
    schedule,
  );
}
```

4. **Add to the collection resolver** in `webflow/client.ts` (add to `ResolvedCollections` type and `resolveCollections()` function).

5. **Register** in `sync/collections.ts` (schema sync) and `sync/index.ts` (data sync).

6. **Add an endpoint** in `index.ts`.

---

## Field Slug Resolution

Field slug resolution is handled automatically by `resolveCollections()`. The resolver caches both collection IDs and slug maps — resolved once, reused everywhere:

```typescript
const cols = await resolveCollections();
const s = (desired: string) => cols.studios.slugMap.get(desired) ?? desired;

// s() resolves the actual Webflow slug:
return {
  [s("external-id")]: item.id, // might resolve to "external-id-2"
  [s("latitude")]: item.lat, // might resolve to "latitude-2"
};
```

This is necessary because of the `-2` slug problem described above. Without it, Webflow rejects the data with `"Field not described in schema"`.
