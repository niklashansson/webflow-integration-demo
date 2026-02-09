import type { CollectionsCreateRequest } from "webflow-api/api/index.js";

// Maps Webflow field types to TypeScript types
type WebflowFieldTypeMap = {
  PlainText: string;
  RichText: string;
  Image: string;
  Number: number;
  Bool: boolean;
  Reference: string;
  MultiReference: string[];
  Video: string;
  Link: string;
  Email: string;
  Phone: string;
  Color: string;
  DateTime: string;
  Option: string;
  File: string;
  User: string;
  MultiImage: string[];
  MultiFile: string[];
};

type SchemaField = {
  readonly id: string;
  readonly type: keyof WebflowFieldTypeMap;
  readonly isRequired?: boolean;
  readonly displayName?: string;
  readonly metadata?: { readonly collectionId?: string };
};

// Infer TypeScript type from schema fields
type InferCollectionItem<Fields extends readonly SchemaField[]> = {
  name: string;
  slug: string;
} & {
  [F in Fields[number] as F["id"]]: F["isRequired"] extends true
    ? WebflowFieldTypeMap[F["type"]]
    : WebflowFieldTypeMap[F["type"]] | undefined;
};

// Field definitions
const categoriesFields = [
  {
    id: "external-id",
    displayName: "External ID",
    type: "PlainText",
    isRequired: true,
  },
] as const satisfies readonly SchemaField[];

const citiesFields = [
  {
    id: "external-id",
    displayName: "External ID",
    type: "PlainText",
    isRequired: true,
  },
] as const satisfies readonly SchemaField[];

const studiosFields = [
  {
    id: "external-id",
    displayName: "External ID",
    type: "PlainText",
    isRequired: true,
  },
  {
    id: "address",
    displayName: "Address",
    type: "PlainText",
    isRequired: false,
  },
  { id: "city", displayName: "City", type: "Reference", isRequired: false },
  {
    id: "description",
    displayName: "Description",
    type: "RichText",
    isRequired: false,
  },
  {
    id: "hero-image",
    displayName: "Hero Image",
    type: "Image",
    isRequired: false,
  },
  {
    id: "latitude",
    displayName: "Latitude",
    type: "PlainText",
    isRequired: false,
  },
  {
    id: "longitude",
    displayName: "Longitude",
    type: "PlainText",
    isRequired: false,
  },
  {
    id: "categories",
    displayName: "Categories",
    type: "MultiReference",
    isRequired: false,
  },
] as const satisfies readonly SchemaField[];

// Schema getters
export const getCategoriesSchema = (): Required<CollectionsCreateRequest> => ({
  displayName: "Categories",
  singularName: "Category",
  slug: "categories",
  fields: [...categoriesFields],
});

export const getCitiesSchema = (): Required<CollectionsCreateRequest> => ({
  displayName: "Cities",
  singularName: "City",
  slug: "cities",
  fields: [...citiesFields],
});

export const getStudiosSchema = (
  categoriesCollectionId: string,
  citiesCollectionId: string,
): Required<CollectionsCreateRequest> => ({
  displayName: "Studios",
  singularName: "Studio",
  slug: "studios",
  fields: studiosFields.map((field) => {
    if (field.id === "categories")
      return { ...field, metadata: { collectionId: categoriesCollectionId } };
    if (field.id === "city")
      return { ...field, metadata: { collectionId: citiesCollectionId } };
    return field;
  }),
});

// Inferred types for collection items
export type StudioCollectionItem = InferCollectionItem<typeof studiosFields>;
export type CategoryCollectionItem = InferCollectionItem<
  typeof categoriesFields
>;
export type CityCollectionItem = InferCollectionItem<typeof citiesFields>;
