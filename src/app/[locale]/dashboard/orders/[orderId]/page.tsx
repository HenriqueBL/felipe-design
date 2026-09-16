import { notFound } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { getAdminOrderDetail } from "@/services/admin-orders";
import { formatDate, formatDateTime, formatMoney, orderStatusLabel } from "@/lib/format";
import OrderStatusForm from "@/components/dashboard/order-status-form";
import ResultUploadForm from "@/components/dashboard/result-upload-form";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);

  if (!UUID_PATTERN.test(orderId)) {
    notFound();
  }

  // RLS permite ao admin enxergar qualquer pedido; a consulta falha graciosamente.
  const detail = await getAdminOrderDetail(orderId).catch(() => null);
  if (!detail) {
    notFound();
  }

  const { order, customerEmail, planAngles, sourceImages, resultImages, revisions } = detail;
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  return (
    <div>
      <h1>{dictionary.dashboard.orderDetailTitle}</h1>

      <div className="panel">
        <h2>{dictionary.dashboard.customerLabel}</h2>
        <p>{customerEmail ?? order.user_id}</p>
        <h2>{dictionary.dashboard.orderPlan}</h2>
        <p>
          {planAngles ?? "-"} {dictionary.services.anglesLabel}
        </p>
        <h2>{dictionary.dashboard.orderQuantity}</h2>
        <p>{order.knife_quantity}</p>
        <h2>{dictionary.dashboard.orderImages}</h2>
        <p>{order.total_images}</p>
        <h2>{dictionary.dashboard.snapshotPrice}</h2>
        <p>
          {formatMoney(order.unit_price_cents, order.currency, intlLocale)} ·{" "}
          {formatMoney(order.total_cents, order.currency, intlLocale)}
        </p>
        <h2>{dictionary.dashboard.orderDeadline}</h2>
        <p>{order.promised_delivery_date !== null ? formatDate(order.promised_delivery_date, intlLocale) : "—"}</p>
        <h2>{dictionary.dashboard.orderCreated}</h2>
        <p>{formatDateTime(order.created_at, intlLocale)}</p>
        <h2>{dictionary.dashboard.paidAtLabel}</h2>
        <p>
          {order.paid_at !== null
            ? formatDateTime(order.paid_at, intlLocale)
            : dictionary.dashboard.notPaidYet}
        </p>
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

      <div className="panel">
        <h2>{dictionary.dashboard.sourcePhotosTitle}</h2>
        <p className="note">
          {order.source_photos_submitted_at !== null
            ? dictionary.dashboard.sourcePhotosSubmittedAt(
                formatDateTime(order.source_photos_submitted_at, intlLocale),
              )
            : dictionary.dashboard.sourcePhotosNotSubmitted}
        </p>
        {sourceImages.length === 0 ? (
          <p>{dictionary.dashboard.noPhotos}</p>
        ) : (
          Array.from({ length: order.knife_quantity }, (_, i) => i + 1).map((knifeIndex) => {
            const knifeImages = sourceImages.filter(
              (image) => (image.knife_index ?? 1) === knifeIndex,
            );
            return (
              <div key={knifeIndex} className="source-photo-knife">
                <h3>
                  {dictionary.dashboard.sourcePhotosKnife(knifeIndex)} —{" "}
                  {dictionary.dashboard.sourcePhotosCount(
                    knifeImages.length,
                    order.required_source_photos_per_knife,
                    order.max_source_photos_per_knife,
                  )}
                </h3>
                {knifeImages.length === 0 ? (
                  <p className="note">{dictionary.dashboard.noPhotos}</p>
                ) : (
                  <ul className="photo-list">
                    {knifeImages.map((image) => (
                      <li key={image.id}>
                        {image.signedUrl !== null ? (
                          <a href={image.signedUrl} target="_blank" rel="noopener noreferrer">
                            <img
                              src={image.signedUrl}
                              alt={image.original_filename ?? image.storage_path}
                              className="source-photo-thumb"
                              loading="lazy"
                            />
                          </a>
                        ) : null}
                        <span>{image.original_filename ?? image.storage_path}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="panel">
        <ResultUploadForm
          locale={current}
          orderId={order.id}
          labels={{
            title: dictionary.dashboard.resultUploadTitle,
            hint: dictionary.dashboard.resultUploadHint,
            button: dictionary.dashboard.resultUploadButton,
            uploading: dictionary.dashboard.resultUploading,
            error: dictionary.dashboard.saveError,
          }}
        />
        {resultImages.length > 0 ? (
          <ul className="photo-list">
            {resultImages.map((image) => (
              <li key={image.id}>
                <span>{image.original_filename ?? image.storage_path}</span>
                {image.signedUrl !== null ? (
                  <a
                    className="btn btn-secondary"
                    href={image.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {dictionary.dashboard.openPhoto}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {revisions.length > 0 ? (
        <div className="panel">
          <h2>{dictionary.dashboard.revisionTitleAdmin}</h2>
          {revisions.map((revision) => (
            <div key={revision.id}>
              <p>
                #{revision.round} · {revision.status}
              </p>
              {revision.notes !== null ? <p className="note">{revision.notes}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
