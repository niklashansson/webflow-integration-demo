import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { syncAll } from "./sync/index.js";
import { syncCollections } from "./sync/collections.js";

const app = new Hono();

// Sync collections (create/update collections and fields)
app.post("/api/sync/collections", async (c) => {
  try {
    const results = await syncCollections();
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

// Full sync (sync all items + cleanup)
app.post("/api/sync/all", async (c) => {
  try {
    const results = await syncAll();
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
