# Webflow CMS Integration Demo

A demonstration of syncing data from a mock database to Webflow CMS using the official [Webflow API](https://developers.webflow.com/). Built with [Hono](https://hono.dev/) and TypeScript.

## Features

- ✅ **Collection Management** – Automatically creates CMS collections (Categories, Cities, Studios)
- ✅ **Type-safe Schemas** – TypeScript-inferred types from Webflow collection field definitions
- ✅ **Smart Sync** – Creates new items, updates existing, and cleans up orphaned entries
- ✅ **Reference Fields** – Supports both single (`Reference`) and multi-reference (`MultiReference`) field types
- ✅ **External ID Tracking** – Uses `external-id` field to maintain sync between source DB and Webflow

---

## Project Structure

```
src/
├── index.ts              # Hono API server with sync endpoints
├── db/                   # Mock database (JSON files)
│   ├── index.ts          # Data access layer with types
│   ├── categories.json   # Sample category data
│   ├── cities.json       # Sample city data
│   └── studios.json      # Sample studio data
├── sync/                 # Sync logic
│   ├── index.ts          # Main sync orchestration (syncAll)
│   ├── collections.ts    # Collection creation & validation
│   ├── categories.ts     # Category item sync
│   ├── cities.ts         # City item sync
│   ├── studios.ts        # Studio item sync (with references)
│   └── cleanup.ts        # Orphaned item removal
└── webflow/              # Webflow API utilities
    ├── client.ts         # API client wrapper & helpers
    └── schemas.ts        # Collection field definitions & types
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Webflow account with a site
- [Webflow API Access Token](https://developers.webflow.com/reference/authorization)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd webflow-integration-demo

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

### Configuration

Edit `.env` with your Webflow credentials:

```env
WEBFLOW_ACCESS_TOKEN=your_access_token_here
WEBFLOW_SITE_ID=your_site_id_here
```

> **Finding your Site ID:** In Webflow, go to Site Settings → General → look for the Site ID in the URL or API section.

### Running the Server

```bash
# Development (with hot reload)
npm run dev

# Production
npm run build
npm start
```

Server runs at `http://localhost:3000`

---

## API Endpoints

### Health Check

```bash
GET /health
```

Returns `{ "status": "ok" }` if the server is running.

### Sync Collections

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

### Full Sync

```bash
POST /api/sync/all
```

Syncs all data from the mock database to Webflow CMS:

1. **Sync Categories** – Creates/updates category items
2. **Sync Cities** – Creates/updates city items
3. **Build ID Mappings** – Maps external IDs to Webflow item IDs
4. **Sync Studios** – Creates/updates studio items with category & city references
5. **Cleanup** – Removes items from Webflow that no longer exist in the source DB

**Example Response:**

```json
{
  "success": true,
  "results": {
    "categories": { "created": 3, "updated": 2 },
    "cities": { "created": 2, "updated": 0 },
    "studios": { "created": 5, "updated": 3 },
    "cleanup": {
      "categories": { "deleted": 0 },
      "cities": { "deleted": 1 },
      "studios": { "deleted": 0 }
    }
  }
}
```

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

3. Add mock data in `src/db/`

4. Create a sync function in `src/sync/`

5. Update `syncAll()` to include your collection

### Modifying Mock Data

Edit the JSON files in `src/db/`:

- `categories.json` – Categories with `id`, `name`, `slug`
- `cities.json` – Cities with `id`, `name`, `slug`
- `studios.json` – Studios with full data including `categoryIds` array

---

## Important Notes

### Webflow API Limitations

- **Field Creation:** The Webflow API can create collections but not add fields to existing collections. If you see warnings about missing fields, add them manually in Webflow Designer.

- **Rate Limits:** The Webflow API has rate limits. For large datasets, consider adding delays between requests.

- **Publishing:** After syncing collections, the site is published automatically. CMS item changes are visible immediately in the Designer and on published sites.

### External ID Pattern

Always include an `external-id` field in your collections. This provides:

- Stable sync between source DB and Webflow
- Ability to update existing items instead of creating duplicates
- Orphan detection for cleanup

---

## Scripts

| Command         | Description                              |
| --------------- | ---------------------------------------- |
| `npm run dev`   | Start development server with hot reload |
| `npm run build` | Compile TypeScript to JavaScript         |
| `npm start`     | Run production server                    |

---

## Tech Stack

- **[Hono](https://hono.dev/)** – Lightweight web framework
- **[webflow-api](https://www.npmjs.com/package/webflow-api)** – Official Webflow API client
- **TypeScript** – Type-safe development
- **tsx** – TypeScript execution with hot reload

---

## License

MIT
