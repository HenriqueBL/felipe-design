import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CartView from "@/components/cart/cart-view";
import { resolveCurrency } from "@/domain/checkout";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { isLocale, type Locale } from "@/lib/i18n/config";

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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ currency?: string }>;
}) {
  const current = resolve((await params).locale);
  const { currency: currencyParam } = await searchParams;
  const dictionary = await getDictionary(current);
  const currency = resolveCurrency(current, currencyParam);
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
          anglesLabel: dictionary.services.anglesLabel,
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
        }}
      />
    </main>
  );
}