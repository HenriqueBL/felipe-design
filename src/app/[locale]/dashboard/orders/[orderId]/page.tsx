import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { getOrderById } from "@/services/orders";
import { formatDateTime, formatMoney, orderStatusLabel } from "@/lib/format";
import OrderStatusForm from "@/components/dashboard/order-status-form";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const order = await getOrderById(orderId);

  if (!order) {
    notFound();
  }

  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  return (
    <div>
      <h1>{dictionary.dashboard.orderDetailTitle}</h1>

      <div className="panel">
        <h2>{dictionary.dashboard.orderId}</h2>
        <p>{order.id}</p>
        <h2>{dictionary.dashboard.orderUser}</h2>
        <p>{order.customer_email ?? order.user_id}</p>
        <h2>{dictionary.dashboard.orderQuantity}</h2>
        <p>{order.knife_quantity}</p>
        <h2>{dictionary.dashboard.orderImages}</h2>
        <p>{order.total_images}</p>
        <h2>{dictionary.dashboard.orderTotal}</h2>
        <p>{formatMoney(order.total_cents, order.currency, intlLocale)}</p>
        <h2>{dictionary.dashboard.orderDeadline}</h2>
        <p>{order.promised_delivery_date}</p>
        <h2>{dictionary.dashboard.orderCreated}</h2>
        <p>{formatDateTime(order.created_at, intlLocale)}</p>
        <h2>{dictionary.dashboard.orderStatus}</h2>
        <p>
          <span className={"badge " + order.status}>
            {orderStatusLabel(order.status, current)}
          </span>
        </p>
      </div>

      <div className="panel">
        <OrderStatusForm
          locale={current}
          order={order}
          labels={{
            changeStatus: dictionary.dashboard.changeStatus,
            saved: dictionary.dashboard.saved,
            saveError: dictionary.dashboard.saveError,
          }}
        />
      </div>
    </div>
  );
}
