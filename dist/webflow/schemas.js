// Field definitions
const categoriesFields = [
    {
        id: "external-id",
        displayName: "External ID",
        type: "PlainText",
        isRequired: true,
    },
];
const citiesFields = [
    {
        id: "external-id",
        displayName: "External ID",
        type: "PlainText",
        isRequired: true,
    },
];
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
];
// Schema getters
export const getCategoriesSchema = () => ({
    displayName: "Categories",
    singularName: "Category",
    slug: "categories",
    fields: [...categoriesFields],
});
export const getCitiesSchema = () => ({
    displayName: "Cities",
    singularName: "City",
    slug: "cities",
    fields: [...citiesFields],
});
export const getStudiosSchema = (categoriesCollectionId, citiesCollectionId) => ({
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
