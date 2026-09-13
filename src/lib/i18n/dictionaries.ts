import type { Locale } from "./config";
import en from "./en";

export type Dictionary = typeof en;

const loaders: Record<Locale, () => Promise<{ default: Dictionary }>> = {
  en: () => import("./en"),
  pt: () => import("./pt"),
};

export async function getDictionary(locale: Locale): Promise<Dictionary> {
  const dictionaryModule = await loaders[locale]();
  return dictionaryModule.default;
}
