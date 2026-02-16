import type { CollectionItemFieldData } from "webflow-api/api/index.js";
import type { CollectionSchema } from "./utils/schema.js";

/**
 * Shape of a local JSON item that acts as Single Source of Truth.
 *
 * Every item has an `id` (the external/business identifier), a `slug`,
 * and a `translations` map keyed by locale tag → localized data.
 */
export type LocalItem<
  LocalizedData extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  slug: string;
  translations: {
    [localeTag: string]: LocalizedData;
  };
};

/**
 * Error entry from a sync or cleanup operation.
 * `step` indicates where in the pipeline the error happened.
 */
export type SyncError = {
  step: "create" | "update" | "publish" | "delete" | "reference" | "general";
  message: string;
  itemId?: string;
  collectionId?: string;
};

/**
 * Aggregate result of a `syncCollection` run.
 */
export type SyncResult = {
  created: number;
  updated: number;
  deleted: number;
  published: number;
  skipped: number;
  errors: SyncError[];
  duration: number;
};

/**
 * Configuration object for `syncCollection`.
 *
 * Everything the engine needs is passed explicitly — no globals.
 */
export type SyncOptions<T extends LocalItem> = {
  /** The Webflow site ID (needed to resolve locales). */
  siteId: string;
  /** The target collection ID in Webflow. */
  collectionId: string;
  /** The local JSON items to sync. */
  items: T[];
  /** Human-readable name for log messages, e.g. "Categories". */
  entityName?: string;
  /**
   * Build Webflow `fieldData` for a given item and locale tag.
   * Must include `name`, `slug`, and the identifier field.
   */
  buildFieldData: (
    item: T,
    webflowLocaleTag: string,
  ) => CollectionItemFieldData;
  /**
   * The Webflow field used to match local items with remote items.
   * Defaults to `"external-id"`.
   */
  identifierField?: string;
  /**
   * Optional schema definition for pre-flight validation.
   * When provided, sync will verify that all required fields exist
   * in Webflow before attempting to create/update items.
   */
  schema?: CollectionSchema;
};

/**
 * Result of a `cleanupDeletedItems` run.
 */
export type CleanupResult = {
  deleted: number;
  deletedIdentifiers: string[];
  deletedWebflowIds: string[];
  errors: SyncError[];
};

/**
 * Describes a reference field on a collection for use with
 * `removeReferencesToItems`.
 */
export type ReferenceFieldDescriptor = {
  /** The Webflow field slug, e.g. "city" or "categories". */
  fieldId: string;
  /** True for MultiReference, false for single Reference. */
  isMulti: boolean;
};

/**
 * Result of a `removeReferencesToItems` run.
 */
export type CleanupReferencesToItemResult = {
  updated: number;
  errors: SyncError[];
};
