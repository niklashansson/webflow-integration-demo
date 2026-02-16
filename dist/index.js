import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { syncCollections } from "./sync/collections.js";
import { getCategoryIdMap, syncAllCategories } from "./sync/categories.js";
import { getAllCategories, getAllCities, getAllStudios } from "./db/index.js";
import { getCityIdMap, syncAllCities } from "./sync/cities.js";
import { syncAllStudios } from "./sync/studios.js";
import { syncAll } from "./sync/index.js";
import { cleanupAll, purgeAllCollections } from "./sync/cleanup.js";
const app = new Hono();
// ----- Authentication Middleware -----
/**
 * API key for protecting destructive endpoints (e.g., purge).
 * Set via ADMIN_API_KEY environment variable.
 * If not set, destructive endpoints will be disabled.
 */
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
/**
 * Verify API key from request.
 * Returns null if valid, or an error response if invalid.
 */
function verifyApiKey(c) {
    // If no admin key is configured, disable destructive endpoints
    if (!ADMIN_API_KEY) {
        return c.json({
            success: false,
            error: "Destructive endpoints are disabled. Set ADMIN_API_KEY environment variable to enable.",
        }, 403);
    }
    const authHeader = c.req.header("Authorization");
    const providedKey = authHeader?.replace("Bearer ", "");
    if (providedKey !== ADMIN_API_KEY) {
        return c.json({
            success: false,
            error: "Invalid or missing API key",
        }, 401);
    }
    return null; // Valid
}
// ----- API Routes -----
// Sync collections
app.post("/api/sync/collections", async (c) => {
    try {
        const results = await syncCollections();
        return c.json({ success: true, results });
    }
    catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Sync failed",
        }, 500);
    }
});
// Cleanup all collection items
app.post("/api/cleanup/all", async (c) => {
    try {
        const results = await cleanupAll(new Set(getAllCategories().map((c) => c.id)), new Set(getAllCities().map((c) => c.id)), new Set(getAllStudios().map((s) => s.id)));
        return c.json({ success: true, results });
    }
    catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Sync failed",
        }, 500);
    }
});
// ⚠️ DANGER: Purge ALL items from ALL collections (cannot be undone!)
// Protected with API key authentication
app.post("/api/purge/all", async (c) => {
    // Verify API key first
    const authError = verifyApiKey(c);
    if (authError) {
        return authError;
    }
    try {
        const results = await purgeAllCollections();
        return c.json({ success: true, results });
    }
    catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Purge failed",
        }, 500);
    }
});
// Sync studios
app.post("/api/sync/studios", async (c) => {
    try {
        const categoryIdMap = await getCategoryIdMap();
        const cityIdMap = await getCityIdMap();
        const results = await syncAllStudios(getAllStudios(), categoryIdMap, cityIdMap);
        return c.json({ success: true, results });
    }
    catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Sync failed",
        }, 500);
    }
});
// Sync categories
app.post("/api/sync/categories", async (c) => {
    try {
        const results = await syncAllCategories(getAllCategories());
        return c.json({ success: true, results });
    }
    catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Sync failed",
        }, 500);
    }
});
// Sync cities
app.post("/api/sync/cities", async (c) => {
    try {
        const results = await syncAllCities(getAllCities());
        return c.json({ success: true, results });
    }
    catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Sync failed",
        }, 500);
    }
});
// Sync all items (sync all items + cleanup)
app.post("/api/sync/all", async (c) => {
    try {
        const results = await syncAll();
        return c.json({ success: true, results });
    }
    catch (error) {
        return c.json({
            success: false,
            error: error instanceof Error ? error.message : "Sync failed",
        }, 500);
    }
});
// Health check
app.get("/health", (c) => c.json({ status: "ok" }));
serve({ fetch: app.fetch, port: 3000 }, (info) => {
    console.log(`Server running on http://localhost:${info.port}`);
});
