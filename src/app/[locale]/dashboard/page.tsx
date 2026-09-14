import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { listOrders, getOrderCounts } from "@/services/orders";
import { formatMoney, orderStatusLabel } from "@/lib/format";

export default async function DashboardHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);

  const [orders, counts] = await Promise.all([listOrders(10), getOrderCounts()]);
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  return (
    <div>
      <h1>{dictionary.dashboard.title}</h1>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">{dictionary.dashboard.pendingOrders}</div>
          <div className="value">{counts.pending}</div>
        </div>
        <div className="stat">
          <div className="label">{dictionary.dashboard.inProgressOrders}</div>
          <div className="value">{counts.inProgress}</div>
        </div>
        <div className="stat">
          <div className="label">{dictionary.dashboard.completedOrders}</div>
          <div className="value">{counts.completed}</div>
        </div>
        <div className="stat">
          <div className="label">{dictionary.dashboard.backlogImages}</div>
          <div className="value">{counts.backlogImages}</div>
        </div>
      </div>

      <h2>{dictionary.dashboard.orderTable}</h2>
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
                <td>{order.promised_delivery_date ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
