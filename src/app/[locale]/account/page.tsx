import Link from "next/link";
import { redirect } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { getCurrentUser } from "@/services/auth";
import { listCustomerOrders } from "@/services/customer-orders";
import { formatDate, formatMoney } from "@/lib/format";
import { accountOrderPath, servicesPath } from "@/lib/paths";
import { deriveOrderDisplayState } from "@/domain/checkout";

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const user = await getCurrentUser();

  if (!user) {
    redirect("/" + current + "/login");
  }

  const orders = await listCustomerOrders(user.id);
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  const stateLabels: Record<string, string> = {
    awaiting_payment: dictionary.order.stateAwaitingPayment,
    awaiting_photos: dictionary.order.stateAwaitingPhotos,
    in_queue: dictionary.order.stateInQueue,
    in_progress: dictionary.order.stateInProgress,
    completed: dictionary.order.stateCompleted,
    cancelled: dictionary.order.stateCancelled,
  };

  return (
    <main className="account-wrap">
      <h1>{dictionary.account.title}</h1>
      <p className="account-subtitle">{dictionary.account.subtitle}</p>

      {orders.length === 0 ? (
        <div className="empty-state">
          <h2>{dictionary.account.emptyTitle}</h2>
          <p>{dictionary.account.emptyDescription}</p>
          <Link href={servicesPath(current)} className="btn btn-primary">
            {dictionary.account.startOrder}
          </Link>
        </div>
      ) : (
        <div>
          {orders.map((order) => {
            const state = deriveOrderDisplayState({
              status: order.status,
              paidAt: order.paid_at,
              sourceImageCount: order.source_image_count,
              totalImages: order.total_images,
            });
            const shortId = order.id.slice(0, 8).toUpperCase();
            return (
              <Link key={order.id} href={accountOrderPath(current, order.id)} className="order-card">
                <div>
                  <div className="order-number">
                    {dictionary.account.orderNumber} #{shortId}
                  </div>
                  <div className="order-meta">
                    {dictionary.account.created}: {formatDate(order.created_at.slice(0, 10), intlLocale)}
                    {" \u00b7 "}
                    {dictionary.account.deadline}: {formatDate(order.promised_delivery_date, intlLocale)}
                  </div>
                  <div className="order-meta">
                    {order.total_images} {dictionary.order.imagesLabel}
                  </div>
                </div>
                <div className="order-total">
                  {formatMoney(order.total_cents, order.currency, intlLocale)}
                </div>
                <span className={"badge " + state}>{stateLabels[state]}</span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
