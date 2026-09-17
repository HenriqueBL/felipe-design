import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/en/dashboard", "/pt/dashboard", "/en/account", "/pt/account", "/en/checkout", "/pt/checkout", "/en/login", "/pt/login", "/api/", "/auth/"],
      },
    ],
    sitemap: siteUrl() + "/sitemap.xml",
  };
}