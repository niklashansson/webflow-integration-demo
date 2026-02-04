import studiosData from "./studios.json" with { type: "json" };
import categoriesData from "./categories.json" with { type: "json" };
import citiesData from "./cities.json" with { type: "json" };

// Type definitions for mock database entities
export type Studio = {
  id: string;
  name: string;
  slug: string;
  address: string;
  city: string;
  description: string | null;
  heroImageUrl: string | null;
  lat: number | null;
  lng: number | null;
  categoryIds: string[];
};

export type Category = {
  id: string;
  name: string;
  slug: string;
};

export type City = {
  id: string;
  name: string;
  slug: string;
};

// Typed data exports
export const studios: Studio[] = studiosData;
export const categories: Category[] = categoriesData;
export const cities: City[] = citiesData;

// Data access functions
export const getAllStudios = (): Studio[] => studios;
export const getAllCategories = (): Category[] => categories;
export const getAllCities = (): City[] => cities;
