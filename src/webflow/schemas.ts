import type { CollectionSchema } from "../utils/schema.js";

export const categoriesSchema: CollectionSchema = {
  displayName: "Categories",
  singularName: "Category",
  slug: "categories",
  fields: [
    {
      slug: "external-id",
      displayName: "External ID",
      type: "PlainText",
      isRequired: true,
      helpText: "Unique identifier from the source system",
    },
  ],
};

export const citiesSchema: CollectionSchema = {
  displayName: "Cities",
  singularName: "City",
  slug: "cities",
  fields: [
    {
      slug: "external-id",
      displayName: "External ID",
      type: "PlainText",
      isRequired: true,
      helpText: "Unique identifier from the source system",
    },
  ],
};

/**
 * Studios schema requires collection IDs for Reference/MultiReference
 * fields, so it's a function rather than a constant.
 *
 * Pass the resolved collection IDs for categories and cities.
 */
export function getStudiosSchema(
  categoriesCollectionId: string,
  citiesCollectionId: string,
): CollectionSchema {
  return {
    displayName: "Studios",
    singularName: "Studio",
    slug: "studios",
    fields: [
      {
        slug: "external-id",
        displayName: "External ID",
        type: "PlainText",
        isRequired: true,
        helpText: "Unique identifier from the source system",
      },
      {
        slug: "address",
        displayName: "Address",
        type: "PlainText",
      },
      {
        slug: "description",
        displayName: "Description",
        type: "RichText",
      },
      {
        slug: "hero-image",
        displayName: "Hero Image",
        type: "Image",
      },
      {
        slug: "latitude",
        displayName: "Latitude",
        type: "PlainText",
      },
      {
        slug: "longitude",
        displayName: "Longitude",
        type: "PlainText",
      },
      {
        slug: "city",
        displayName: "City",
        type: "Reference",
        metadata: { collectionId: citiesCollectionId },
      },
      {
        slug: "categories",
        displayName: "Categories",
        type: "MultiReference",
        metadata: { collectionId: categoriesCollectionId },
      },
    ],
  };
}
