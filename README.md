# Webflow CMS Integration Demo

A demonstration of syncing data from a mock database to Webflow CMS using the official [Webflow API](https://developers.webflow.com/). Built with [Hono](https://hono.dev/) and TypeScript.

## Features

- ✅ **Collection Management** – Automatically creates CMS collections (Categories, Cities, Studios)
- ✅ **Type-safe Schemas** – TypeScript-inferred types from Webflow collection field definitions
- ✅ **Smart Sync** – Creates new items, updates existing, and cleans up orphaned entries
- ✅ **Reference Fields** – Supports both single (`Reference`) and multi-reference (`MultiReference`) field types
- ✅ **External ID Tracking** – Uses `external-id` field to maintain sync between source DB and Webflow
- ✅ **Multi-Locale Support** – Syncs content across multiple locales (Swedish, English)

---

## Project Structure

```
src/
├── index.ts              # Hono API server with sync endpoints
├── db/                   # Mock database (JSON files)
│   ├── index.ts          # Data access layer with types & locale support
│   ├── categories.json   # Localized category data (sv/en)
│   ├── cities.json       # Localized city data (sv/en)
│   └── studios.json      # Localized studio data (sv/en)
├── sync/                 # Sync logic
│   ├── index.ts          # Main sync orchestration (syncAll)
│   ├── utils.ts          # Generic sync function & shared types
│   ├── collections.ts    # Collection creation & validation
│   ├── categories.ts     # Category item sync with localization
│   ├── cities.ts         # City item sync with localization
│   ├── studios.ts        # Studio item sync with localization
│   └── cleanup.ts        # Orphaned item & reference cleanup
└── webflow/              # Webflow API utilities
    ├── client.ts         # API client wrapper, locale helpers
    └── schemas.ts        # Collection field definitions & types
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Webflow account with a site
- [Webflow API Access Token](https://developers.webflow.com/reference/authorization)
- **Localization enabled** in your Webflow site (for multi-locale support)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd webflow-integration-demo

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
```

### Configuration

Edit `.env` with your Webflow credentials:

```env
WEBFLOW_ACCESS_TOKEN=your_access_token_here
WEBFLOW_SITE_ID=your_site_id_here
WEBFLOW_CATEGORIES_COLLECTION_SLUG=categories
WEBFLOW_CITIES_COLLECTION_SLUG=cities
WEBFLOW_STUDIOS_COLLECTION_SLUG=studios
```

> **Finding your Site ID:** In Webflow, go to Site Settings → General → look for the Site ID in the URL or API section.

### Running the Server

```bash
# Development (with hot reload)
pnpm dev

# Production
pnpm build
pnpm start
```

Server runs at `http://localhost:3000`

---

## API Endpoints

### Health Check

```bash
GET /health
```

Returns `{ "status": "ok" }` if the server is running.

### Sync Collections (Schema)

```bash
POST /api/sync/collections
```

Creates/validates CMS collections in Webflow:

1. **Categories** – Simple collection with `external-id` field
2. **Cities** – Simple collection with `external-id` field
3. **Studios** – Collection with reference fields to Categories and Cities

This endpoint will:

- Create collections if they don't exist
- Warn about missing fields (fields must be added manually in Webflow Designer)
- Publish the site after syncing

**Example Response:**

```json
{
  "success": true,
  "results": {
    "collections": {
      "categories": { "id": "...", "displayName": "Categories" },
      "cities": { "id": "...", "displayName": "Cities" },
      "studios": { "id": "...", "displayName": "Studios" }
    },
    "warnings": [],
    "errors": []
  }
}
```

### Full Sync (All Items + Cleanup)

```bash
POST /api/sync/all
```

Syncs all data from the mock database to Webflow CMS **across all configured locales**:

1. **Sync Categories** – Creates/updates category items in all locales
2. **Sync Cities** – Creates/updates city items in all locales
3. **Build ID Mappings** – Maps external IDs to Webflow item IDs
4. **Sync Studios** – Creates/updates studio items with category & city references
5. **Cleanup** – Removes orphaned items and cleans up dangling references

### Individual Sync Endpoints

```bash
POST /api/sync/categories   # Sync only categories
POST /api/sync/cities       # Sync only cities
POST /api/sync/studios      # Sync only studios
POST /api/cleanup/all       # Run cleanup only
```

**Example Response (per-entity sync):**

```json
{
  "success": true,
  "results": {
    "created": 3,
    "updated": 2,
    "published": 5,
    "errors": [],
    "duration": 1250
  }
}
```

---

## Localization Support

This demo supports multi-locale content synchronization using Webflow's Localization API.

### How It Works

1. **Webflow Site Configuration**: Enable localization in Webflow and add your desired locales (e.g., English as primary, Swedish as secondary)

2. **Data Structure**: The mock database uses a nested `locales` object:

```json
{
  "id": "cat_006",
  "slug": "high-intensity",
  "locales": {
    "sv": { "name": "Högintensiv" },
    "en": { "name": "High Intensity" }
  }
}
```

3. **Sync Process**:
   - When creating a **new item**, the API creates variants for all locales at once using `createItems`
   - Primary locale content is set during creation
   - Secondary locales are updated with translated content using `updateItemLive`
   - When **updating** an existing item, each locale variant is updated independently

### Locale Mapping

The sync maps Webflow locale tags to database locale keys:

| Webflow Tag   | DB Locale |
| ------------- | --------- |
| `sv-SE`, `sv` | `sv`      |
| `en-US`, `en` | `en`      |

### Adding More Locales

1. Add the locale in `src/db/index.ts`:

   ```typescript
   export type SupportedLocale = "sv" | "en" | "de";
   export const SUPPORTED_LOCALES: SupportedLocale[] = ["sv", "en", "de"];
   ```

2. Update the mapping function in `src/webflow/client.ts`:

   ```typescript
   const mapping: Record<string, SupportedLocale> = {
     "sv-SE": "sv",
     "en-US": "en",
     "de-DE": "de",
   };
   ```

3. Add translated content to your JSON files

4. Enable the locale in Webflow Designer

### Important: API Limitations

- **New locales on existing items**: The Webflow API cannot add new locales to items that already exist. If you add a new locale to your site, existing items must have the locale added manually in Webflow Designer before syncing.

- **Locale-specific publishing**: Each locale maintains its own publishing state. Changes in one locale don't affect others.

---

## How It Works

### Collection Schemas

Schemas are defined in `src/webflow/schemas.ts` using TypeScript for type inference:

```typescript
const studiosFields = [
  { id: "external-id", type: "PlainText", isRequired: true },
  { id: "address", type: "PlainText", isRequired: false },
  { id: "city", type: "Reference", isRequired: false },
  { id: "categories", type: "MultiReference", isRequired: false },
  // ... more fields
] as const;
```

Types are automatically inferred:

```typescript
type StudioCollectionItem = {
  name: string;
  slug: string;
  "external-id": string;
  address: string | undefined;
  city: string | undefined; // Reference ID
  categories: string[] | undefined; // Array of Reference IDs
};
```

### Sync Strategy

The sync process uses **external IDs** to maintain a stable mapping between your source database and Webflow:

1. Each item in the source DB has a unique `id`
2. This ID is stored in Webflow's `external-id` field
3. During sync, items are matched by `external-id` (or by `slug` as fallback)
4. If found → update, otherwise → create

### Reference Field Handling

For reference fields:

1. First sync the referenced collections (Categories, Cities)
2. Build a mapping: `external-id → Webflow item ID`
3. When syncing Studios, translate `categoryIds` to Webflow item IDs

```typescript
// Transform source category IDs to Webflow item IDs
const webflowCategoryIds = studio.categoryIds
  .map((id) => categoryIdMap.get(id))
  .filter(Boolean);
```

---

## Customization

### Adding New Collections

1. Define fields in `src/webflow/schemas.ts`:

   ```typescript
   const myCollectionFields = [
     { id: "external-id", type: "PlainText", isRequired: true },
     // ... your fields
   ] as const;
   ```

2. Create a schema getter:

   ```typescript
   export const getMyCollectionSchema = () => ({
     displayName: "My Collection",
     singularName: "My Item",
     slug: "my-collection",
     fields: [...myCollectionFields],
   });
   ```

3. Add mock data in `src/db/` with localized structure

4. Create a sync function in `src/sync/`

5. Update `syncAll()` to include your collection

### Mock Data Structure (with Localization)

Edit the JSON files in `src/db/`:

**categories.json / cities.json:**

```json
{
  "id": "cat_001",
  "slug": "barre",
  "locales": {
    "sv": { "name": "Barre" },
    "en": { "name": "Barre" }
  }
}
```

**studios.json:**

```json
{
  "id": "studio_001",
  "slug": "bruce-studios-vasastan",
  "address": "Odengatan 42",
  "city": "city_stockholm",
  "categoryIds": ["cat_009", "cat_011"],
  "locales": {
    "sv": {
      "name": "Bruce Studios Vasastan",
      "description": "Ett premium träningscenter..."
    },
    "en": {
      "name": "Bruce Studios Vasastan",
      "description": "A premium fitness center..."
    }
  }
}
```

---

## Important Notes

### Webflow API Limitations

- **Field Creation:** The Webflow API can create collections but not add fields to existing collections. If you see warnings about missing fields, add them manually in Webflow Designer.

- **Rate Limits:** The Webflow API has rate limits. For large datasets, consider adding delays between requests.

- **Publishing:** After syncing collections, the site is published automatically. CMS item changes are visible immediately in the Designer and on published sites.

- **Localization:** Cannot add new locales to existing items via API. Add locales manually in Webflow first.

### External ID Pattern

Always include an `external-id` field in your collections. This provides:

- Stable sync between source DB and Webflow
- Ability to update existing items instead of creating duplicates
- Orphan detection for cleanup

---

## Scripts

| Command      | Description                              |
| ------------ | ---------------------------------------- |
| `pnpm dev`   | Start development server with hot reload |
| `pnpm build` | Compile TypeScript to JavaScript         |
| `pnpm start` | Run production server                    |

---

## Tech Stack

- **[Hono](https://hono.dev/)** – Lightweight web framework
- **[webflow-api](https://www.npmjs.com/package/webflow-api)** – Official Webflow API client
- **TypeScript** – Type-safe development
- **tsx** – TypeScript execution with hot reload

---

## License

MIT
