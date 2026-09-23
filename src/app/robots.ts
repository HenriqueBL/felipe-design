import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/en/dashboard",
          "/pt/dashboard",
          "/en/account",
          "/pt/account",
          "/pt/conta",
          "/en/checkout",
          "/pt/checkout",
          "/pt/finalizar",
          "/en/cart",
          "/pt/cart",
          "/pt/carrinho",
          "/en/login",
          "/pt/login",
          "/api/",
          "/auth/",
        ],
      },
    ],
    sitemap: siteUrl() + "/sitemap.xml",
  };
}