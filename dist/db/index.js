import studiosData from "./studios.json" with { type: "json" };
import categoriesData from "./categories.json" with { type: "json" };
import citiesData from "./cities.json" with { type: "json" };
export const SUPPORTED_LOCALES = ["sv", "en"];
export const PRIMARY_LOCALE = "en";
// Typed data exports
export const studios = studiosData;
export const categories = categoriesData;
export const cities = citiesData;
// Data access functions
export const getAllStudios = () => studios;
export const getAllCategories = () => categories;
export const getAllCities = () => cities;
// Helper to get localized value with fallback to primary locale
export function getLocalizedValue(locales, locale) {
    return locales[locale] ?? locales[PRIMARY_LOCALE];
}
