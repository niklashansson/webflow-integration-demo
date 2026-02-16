import studiosData from "./studios.json" with { type: "json" };
import categoriesData from "./categories.json" with { type: "json" };
import citiesData from "./cities.json" with { type: "json" };

// Supported locales for localized content
export type SupportedLocale = "sv" | "en";
export const PRIMARY_LOCALE: SupportedLocale = "en";

export type Category = {
  id: string;
  slug: string;
  translations: Record<
    SupportedLocale,
    {
      name: string;
    }
  >;
};

export type City = {
  id: string;
  slug: string;
  translations: Record<
    SupportedLocale,
    {
      name: string;
    }
  >;
};

export type Studio = {
  id: string;
  slug: string;
  address: string;
  city: string;
  heroImageUrl: string | null;
  lat: string | null;
  lng: string | null;
  categoryIds: string[];
  translations: Record<
    SupportedLocale,
    {
      name: string;
      description: string;
    }
  >;
};

// Typed data exports
export const studios: Studio[] = studiosData as Studio[];
export const categories: Category[] = categoriesData as Category[];
export const cities: City[] = citiesData as City[];

// Data access functions
export const getAllStudios = (): Studio[] => studios;
export const getAllCategories = (): Category[] => categories;
export const getAllCities = (): City[] => cities;
