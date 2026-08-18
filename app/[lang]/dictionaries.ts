import { notFound } from "next/navigation";

export const locales = ["en", "ar"] as const;

export type Locale = (typeof locales)[number];

const dictionaries = {
  en: () => import("./dictionaries/en.json").then((m) => m.default),
  ar: () => import("./dictionaries/ar.json").then((m) => m.default),
} as const;

export type Dictionary = (typeof dictionaries)[Locale];

/* The resolved, awaited dictionary shape for a locale (i.e. the JSON content). */
export type DictionaryData = Awaited<ReturnType<typeof getDictionary>>;

export const hasLocale = (locale: string): locale is Locale =>
  (locales as readonly string[]).includes(locale);

export const getDictionary = async (locale: string) => {
  if (!hasLocale(locale)) notFound();
  return dictionaries[locale]();
};
