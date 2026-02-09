import studiosData from "./studios.json" with { type: "json" };
import categoriesData from "./categories.json" with { type: "json" };
import citiesData from "./cities.json" with { type: "json" };

// Supported locales for localized content
export type SupportedLocale = "sv" | "en";
export const SUPPORTED_LOCALES: SupportedLocale[] = ["sv", "en"];
export const PRIMARY_LOCALE: SupportedLocale = "en";

// Type definitions for mock database entities with localization
export type Category = {
  id: string;
  slug: string;
  locales: Record<
    SupportedLocale,
    {
      name: string;
    }
  >;
};

export type City = {
  id: string;
  slug: string;
  locales: Record<
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
  locales: Record<
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

// Helper to get localized value with fallback to primary locale
export function getLocalizedValue<T>(
  locales: Record<SupportedLocale, T>,
  locale: SupportedLocale,
): T {
  return locales[locale] ?? locales[PRIMARY_LOCALE];
}
