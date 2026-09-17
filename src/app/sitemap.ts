import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();

  return [
    { url: base + "/en", lastModified, changeFrequency: "monthly", priority: 1 },
    { url: base + "/en/services", lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: base + "/en/about", lastModified, changeFrequency: "yearly", priority: 0.6 },
    { url: base + "/en/gallery", lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: base + "/pt", lastModified, changeFrequency: "monthly", priority: 0.9 },
    { url: base + "/pt/servicos", lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: base + "/pt/sobre", lastModified, changeFrequency: "yearly", priority: 0.6 },
    { url: base + "/pt/galeria", lastModified, changeFrequency: "monthly", priority: 0.7 },
  ];
}