import studiosData from "./studios.json" with { type: "json" };
import categoriesData from "./categories.json" with { type: "json" };
import citiesData from "./cities.json" with { type: "json" };
// Typed data exports
export const studios = studiosData;
export const categories = categoriesData;
export const cities = citiesData;
// Data access functions
export const getAllStudios = () => studios;
export const getAllCategories = () => categories;
export const getAllCities = () => cities;
