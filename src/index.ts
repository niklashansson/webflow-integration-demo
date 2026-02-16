import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { getAllCategories, getAllCities, getAllStudios } from "./db/index.js";
import { syncStudiosToWebflow } from "./sync/studios.js";
import { syncCategoriesToWebflow } from "./sync/categories.js";
import { syncCitiesToWebflow } from "./sync/cities.js";
import { syncAll } from "./sync/index.js";
import { cleanupAll } from "./sync/cleanup.js";
import {
  syncAllCollectionSchemas,
  validateAllCollectionSchemas,
} from "./sync/collections.js";

const app = new Hono();

// Sync collection schemas (create collections + fields from code-defined schemas)
app.post("/api/sync/collections", async (c) => {
  try {
    const results = await syncAllCollectionSchemas();
    return c.json({ success: true, results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      500,
    );
  }
});

// Validate collection schemas (read-only check, no changes)
app.get("/api/validate/collections", async (c) => {
  try {
    const results = await validateAllCollectionSchemas();
    return c.json({ success: true, results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Validation failed",
      },
      500,
    );
  }
});

// Cleanup all collection items
app.post("/api/cleanup/all", async (c) => {
  try {
    const results = await cleanupAll(
      new Set(getAllCategories().map((c) => c.id)),
      new Set(getAllCities().map((c) => c.id)),
      new Set(getAllStudios().map((s) => s.id)),
    );
    return c.json({ success: true, results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      500,
    );
  }
});

// Sync studios
app.post("/api/sync/studios", async (c) => {
  try {
    const studios = getAllStudios();
    console.log(`🧪 Syncing ${studios.length} studios`);
    const results = await syncStudiosToWebflow(studios);
    return c.json({ success: true, results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      500,
    );
  }
});

// Sync categories
app.post("/api/sync/categories", async (c) => {
  try {
    const categories = getAllCategories();
    console.log(`🧪 Syncing ${categories.length} categories`);
    const results = await syncCategoriesToWebflow(categories);
    return c.json({ success: true, results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      500,
    );
  }
});

// Sync cities
app.post("/api/sync/cities", async (c) => {
  try {
    const cities = getAllCities();
    console.log(`🧪 Syncing ${cities.length} cities`);
    const results = await syncCitiesToWebflow(cities);
    return c.json({ success: true, results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      500,
    );
  }
});

// Sync all items in dependency order + cleanup
app.post("/api/sync/all", async (c) => {
  try {
    const results = await syncAll(
      getAllCategories(),
      getAllCities(),
      getAllStudios(),
    );
    return c.json({ success: true, results });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Sync failed",
      },
      500,
    );
  }
});

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
