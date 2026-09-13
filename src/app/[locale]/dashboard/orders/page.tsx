import Link from "next/link";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { listOrders } from "@/services/orders";
import { formatDateTime, formatMoney, orderStatusLabel } from "@/lib/format";

export default async function DashboardOrdersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const orders = await listOrders(50);
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  return (
    <div>
      <h1>{dictionary.dashboard.orders}</h1>
      {orders.length === 0 ? (
        <p className="muted">{dictionary.dashboard.noOrders}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{dictionary.dashboard.orderCustomer}</th>
              <th>{dictionary.dashboard.orderImages}</th>
              <th>{dictionary.dashboard.orderTotal}</th>
              <th>{dictionary.dashboard.orderStatus}</th>
              <th>{dictionary.dashboard.orderDeadline}</th>
              <th>{dictionary.dashboard.orderCreated}</th>
              <th>{dictionary.dashboard.orderActions}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>{order.customer_email ?? "-"}</td>
                <td>{order.total_images}</td>
                <td>{formatMoney(order.total_cents, order.currency, intlLocale)}</td>
                <td>
                  <span className={"badge " + order.status}>
                    {orderStatusLabel(order.status, current)}
                  </span>
                </td>
                <td>{order.promised_delivery_date}</td>
                <td>{formatDateTime(order.created_at, intlLocale)}</td>
                <td>
                  <Link href={"/" + current + "/dashboard/orders/" + order.id}>
                    {dictionary.dashboard.viewDetails}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
