import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";

import CartView from "@/components/cart/cart-view";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { extractCountry, resolveMarket } from "@/lib/market";

function resolve(locale: string): Locale {
  if (!isLocale(locale)) {
    notFound();
  }
  return locale;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const current = resolve((await params).locale);
  const dictionary = await getDictionary(current);
  return {
    title: dictionary.cart.title + " | Felipe Design",
    robots: { index: false, follow: false },
  };
}

export default async function CartPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const current = resolve((await params).locale);
  const dictionary = await getDictionary(current);

  // Server-authoritative currency: derived from country, never from query params.
  const requestHeaders = await headers();
  const country = extractCountry(requestHeaders);
  const market = resolveMarket(country);
  const currency = market.currency;
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  return (
    <main className="cart-main">
      <CartView
        locale={current}
        intlLocale={intlLocale}
        currency={currency}
        labels={{
          title: dictionary.cart.title,
          emptyTitle: dictionary.cart.emptyTitle,
          emptyDescription: dictionary.cart.emptyDescription,
          angleSingularPerKnife: dictionary.services.angleSingularPerKnife,
          anglePluralPerKnife: dictionary.services.anglePluralPerKnife,
          priceUnavailable: dictionary.services.priceUnavailable,
          unitPrice: dictionary.cart.unitPrice,
          subtotal: dictionary.cart.subtotal,
          total: dictionary.cart.total,
          totalImages: dictionary.cart.totalImages,
          quantity: dictionary.cart.quantity,
          remove: dictionary.cart.remove,
          clear: dictionary.cart.clear,
          continueShopping: dictionary.cart.continueShopping,
          checkout: dictionary.cart.checkout,
          maxKnivesError: dictionary.cart.maxKnivesError,
        }}
      />
    </main>
  );
}