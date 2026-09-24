import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { parseCheckoutParams } from "@/domain/checkout";
import { getActivePlanWithPrice } from "@/services/plans";
import { fetchDeliveryEstimate } from "@/services/delivery-estimate";
import { getCurrentUser } from "@/services/auth";
import { formatMoney } from "@/lib/format";
import { checkoutPath, servicesPath } from "@/lib/paths";
import { extractCountry, resolveMarket } from "@/lib/market";
import LoginForm from "@/components/login-form";
import CreateOrderForm from "@/components/checkout/create-order-form";
import CartCheckoutView from "@/components/checkout/cart-checkout-view";
import type { EstimateDeliveryResult } from "@/types/database";

function resolve(locale: string): Locale {
  return isLocale(locale) ? locale : defaultLocale;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const current = resolve((await params).locale);
  const dictionary = await getDictionary(current);
  return {
    title: dictionary.checkout.title + " | Felipe Design",
    robots: { index: false, follow: false },
  };
}

function toURLSearchParams(
  input: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const output = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      output.set(key, value);
    }
  }
  return output;
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = resolve((await params).locale);
  const query = await searchParams;
  const dictionary = await getDictionary(current);

  // Server-authoritative currency: derived from country, never from query params.
  const requestHeaders = await headers();
  const country = extractCountry(requestHeaders);
  const market = resolveMarket(country);
  const currency = market.currency;
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  // Cart checkout: ?cart=1 signals multi-item flow. Client-side cart-store
  // provides items; server revalidates prices via /api/cart-pricing before
  // submission. User check happens server-side so the client component
  // receives auth state as a prop (no server calls from client).
  const isCartCheckout = query.cart === "1";

  if (isCartCheckout) {
    const user = await getCurrentUser();
    return (
      <CartCheckoutView
        locale={current}
        intlLocale={intlLocale}
        user={user && user.email ? { email: user.email } : null}
        labels={{
          title: dictionary.checkout.title,
          cartItemsTitle: dictionary.checkout.cartItemsTitle,
          invalidCart: dictionary.checkout.invalidCart,
          angleSingularPerKnife: dictionary.services.angleSingularPerKnife,
          anglePluralPerKnife: dictionary.services.anglePluralPerKnife,
          knivesLabel: dictionary.checkout.knivesLabel,
          imagesLabel: dictionary.checkout.imagesLabel,
          unitPrice: dictionary.checkout.unitPrice,
          subtotal: dictionary.cart.subtotal,
          total: dictionary.checkout.total,
          totalImages: dictionary.cart.totalImages,
          estimatedTurnaround: dictionary.checkout.estimatedTurnaround,
          businessDaysAfterReady: dictionary.checkout.businessDaysAfterReady,
          backlogNote: dictionary.checkout.backlogNote,
          deadlineNote: dictionary.checkout.deadlineNote,
          estimateUnavailable: dictionary.checkout.estimateUnavailable,
          signedInAs: dictionary.checkout.signedInAs,
          loginRequired: dictionary.checkout.loginRequired,
          emailLabel: dictionary.checkout.emailLabel,
          emailPlaceholder: dictionary.checkout.emailPlaceholder,
          sendMagicLink: dictionary.checkout.sendMagicLink,
          magicLinkSent: dictionary.checkout.magicLinkSent,
          magicLinkRateLimited: dictionary.checkout.magicLinkRateLimited,
          error: dictionary.checkout.error,
          backToServices: dictionary.checkout.backToServices,
          backToCart: dictionary.cart.continueShopping,
          createCartOrder: dictionary.checkout.createCartOrder,
          creatingCartOrder: dictionary.checkout.creatingCartOrder,
          invalidSelection: dictionary.checkout.invalidSelection,
          planUnavailable: dictionary.checkout.planUnavailable,
          priceUnavailable: dictionary.cart.priceUnavailable ?? "",
        }}
      />
    );
  }

  const checkoutParams = parseCheckoutParams(toURLSearchParams(query));

  if (!checkoutParams) {
    return (
      <main className="checkout-wrap">
        <h1>{dictionary.checkout.title}</h1>
        <p className="state-note">{dictionary.checkout.invalidSelection}</p>
        <Link href={servicesPath(current)} className="back-link">
          {dictionary.checkout.backToServices}
        </Link>
      </main>
    );
  }

  const planWithPrice = await getActivePlanWithPrice(
    checkoutParams.planId,
    currency,
  ).catch(() => null);

  if (!planWithPrice) {
    return (
      <main className="checkout-wrap">
        <h1>{dictionary.checkout.title}</h1>
        <p className="state-note">{dictionary.checkout.planUnavailable}</p>
        <Link href={servicesPath(current)} className="back-link">
          {dictionary.checkout.backToServices}
        </Link>
      </main>
    );
  }

  const { plan, priceCents } = planWithPrice;
  const totalImages = checkoutParams.quantity * plan.angles;
  const totalCents = priceCents * checkoutParams.quantity;

  // Prazo vem sempre do backend (RPC estimate_delivery), nunca do browser.
  let estimate: EstimateDeliveryResult | null = null;
  try {
    estimate = await fetchDeliveryEstimate(totalImages);
  } catch {
    estimate = null;
  }

  const user = await getCurrentUser();

  // URL de retorno pos-login preserva apenas a intencao (plano, quantidade,
  // chave). Moeda e preco sao resolvidos no servidor.
  const nextUrl =
    checkoutPath(current) +
    "?" +
    new URLSearchParams({
      plan: checkoutParams.planId,
      qty: String(checkoutParams.quantity),
      key: checkoutParams.idempotencyKey,
    }).toString();

  return (
    <main className="checkout-wrap">
      <h1>{dictionary.checkout.title}</h1>
      <div className="checkout-grid">
        <section className="summary-panel">
          <h2>{dictionary.checkout.summaryTitle}</h2>
          <div className="summary-rows">
            <div className="row">
              <span>{dictionary.checkout.planLabel}</span>
              <span>
                {plan.angles}{" "}
                {plan.angles === 1
                  ? dictionary.services.angleSingularPerKnife
                  : dictionary.services.anglePluralPerKnife}
              </span>
            </div>
            <div className="row">
              <span>{dictionary.checkout.knivesLabel}</span>
              <span>{checkoutParams.quantity}</span>
            </div>
            <div className="row">
              <span>{dictionary.checkout.imagesLabel}</span>
              <span>{totalImages}</span>
            </div>
            <div className="row">
              <span>{dictionary.checkout.unitPrice}</span>
              <span>{formatMoney(priceCents, currency, intlLocale)}</span>
            </div>
            <div className="row total">
              <span>{dictionary.checkout.total}</span>
              <span>{formatMoney(totalCents, currency, intlLocale)}</span>
            </div>
          </div>
        </section>

        <section className="estimate-panel">
          <h2>{dictionary.checkout.estimatedTurnaround}</h2>
          {estimate !== null ? (
            <div>
              <span className="deadline-big">
                {estimate.businessDaysAfterReady} {dictionary.checkout.businessDaysAfterReady}
              </span>
              <p className="deadline-meta">{dictionary.checkout.backlogNote}</p>
            </div>
          ) : (
            <p className="deadline-meta">{dictionary.checkout.estimateUnavailable}</p>
          )}
          <p className="note">{dictionary.checkout.deadlineNote}</p>
        </section>

        <section className="auth-panel">
          {user ? (
            <div>
              <p className="note">
                {dictionary.checkout.signedInAs} {user.email}
              </p>
              <CreateOrderForm
                locale={current}
                labels={{
                  createOrder: dictionary.checkout.createOrder,
                  creating: dictionary.checkout.creating,
                  invalidSelection: dictionary.checkout.invalidSelection,
                  loginRequired: dictionary.checkout.loginRequired,
                  planUnavailable: dictionary.checkout.planUnavailable,
                  error: dictionary.checkout.error,
                }}
                planId={checkoutParams.planId}
                quantity={checkoutParams.quantity}
                currency={currency}
                idempotencyKey={checkoutParams.idempotencyKey}
              />
            </div>
          ) : (
            <div>
              <p className="note">{dictionary.checkout.loginRequired}</p>
              <LoginForm
                locale={current}
                labels={{
                  emailLabel: dictionary.checkout.emailLabel,
                  emailPlaceholder: dictionary.checkout.emailPlaceholder,
                  submit: dictionary.checkout.sendMagicLink,
                  success: dictionary.checkout.magicLinkSent,
                  error: dictionary.checkout.error,
                  rateLimited: dictionary.checkout.magicLinkRateLimited,
                }}
                next={nextUrl}
              />
            </div>
          )}
        </section>
      </div>
      <Link href={servicesPath(current)} className="back-link">
        {dictionary.checkout.backToServices}
      </Link>
    </main>
  );
}