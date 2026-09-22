import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();

  return [
    { url: base + "/en", changeFrequency: "monthly", priority: 1 },
    { url: base + "/en/services", changeFrequency: "monthly", priority: 0.8 },
    { url: base + "/en/about", changeFrequency: "yearly", priority: 0.6 },
    { url: base + "/en/gallery", changeFrequency: "monthly", priority: 0.7 },
    { url: base + "/pt", changeFrequency: "monthly", priority: 0.9 },
    { url: base + "/pt/servicos", changeFrequency: "monthly", priority: 0.7 },
    { url: base + "/pt/sobre", changeFrequency: "yearly", priority: 0.6 },
    { url: base + "/pt/galeria", changeFrequency: "monthly", priority: 0.7 },
  ];
}