import { describe, it, expect } from "vitest";
import { publicPath } from "@/lib/site";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("publicPath", () => {
  it.each([
    ["en", "home", "/en"],
    ["pt", "home", "/pt"],
    ["en", "services", "/en/services"],
    ["pt", "services", "/pt/servicos"],
    ["en", "about", "/en/about"],
    ["pt", "about", "/pt/sobre"],
    ["en", "gallery", "/en/gallery"],
    ["pt", "gallery", "/pt/galeria"],
  ] as const)(
    "returns correct path for locale=%s page=%s",
    (locale, page, expected) => {
      expect(publicPath(locale, page)).toBe(expected);
    },
  );
});

describe("sitemap", () => {
  it("contains only real public URLs without artificial lastModified", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);

    // Must include all public pages in both locales
    expect(urls.some((u) => u.endsWith("/en"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/en/services"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/en/about"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/en/gallery"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/pt"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/pt/servicos"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/pt/sobre"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/pt/galeria"))).toBe(true);

    // Must NOT include root / or non-public routes
    expect(urls.some((u) => u.match(/^https?:\/\/[^/]+\/$/))).toBe(false);
    expect(urls.some((u) => u.includes("/dashboard"))).toBe(false);
    expect(urls.some((u) => u.includes("/account"))).toBe(false);
    expect(urls.some((u) => u.includes("/cart"))).toBe(false);
    expect(urls.some((u) => u.includes("/checkout"))).toBe(false);
    expect(urls.some((u) => u.includes("/login"))).toBe(false);

    // Must NOT have artificial lastModified timestamps
    for (const entry of entries) {
      expect(entry.lastModified).toBeUndefined();
    }
  });

  it("uses semantic PT routes not internal English slugs", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);

    // PT must use semantic routes
    expect(urls.some((u) => u.endsWith("/pt/servicos"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/pt/sobre"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/pt/galeria"))).toBe(true);

    // Must NOT have internal English slugs under /pt
    expect(urls.some((u) => u.includes("/pt/services"))).toBe(false);
    expect(urls.some((u) => u.includes("/pt/about"))).toBe(false);
    expect(urls.some((u) => u.includes("/pt/gallery"))).toBe(false);
  });
});

describe("robots", () => {
  it("blocks cart/carrinho along with other non-public routes", () => {
    const config = robots();
    const disallow = config.rules?.[0]?.disallow ?? [];

    expect(disallow).toContain("/en/cart");
    expect(disallow).toContain("/pt/cart");
    expect(disallow).toContain("/pt/carrinho");

    // Existing blocks preserved
    expect(disallow).toContain("/en/dashboard");
    expect(disallow).toContain("/pt/dashboard");
    expect(disallow).toContain("/en/account");
    expect(disallow).toContain("/pt/account");
    expect(disallow).toContain("/pt/conta");
    expect(disallow).toContain("/en/checkout");
    expect(disallow).toContain("/pt/checkout");
    expect(disallow).toContain("/pt/finalizar");
    expect(disallow).toContain("/en/login");
    expect(disallow).toContain("/pt/login");
    expect(disallow).toContain("/api/");
    expect(disallow).toContain("/auth/");
  });

  it("does not block public pages", () => {
    const config = robots();
    const disallow = config.rules?.[0]?.disallow ?? [];

    // Public pages must NOT be blocked
    expect(disallow).not.toContain("/en");
    expect(disallow).not.toContain("/pt");
    expect(disallow).not.toContain("/en/services");
    expect(disallow).not.toContain("/pt/servicos");
    expect(disallow).not.toContain("/en/about");
    expect(disallow).not.toContain("/pt/sobre");
    expect(disallow).not.toContain("/en/gallery");
    expect(disallow).not.toContain("/pt/galeria");
  });
});