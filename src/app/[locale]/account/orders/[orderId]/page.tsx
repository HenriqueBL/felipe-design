import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { getCurrentUser } from "@/services/auth";
import {
  createSignedDownloadUrl,
  getCustomerOrderDetail,
} from "@/services/customer-orders";
import { formatDate, formatDateLong, formatDateTime, formatMoney } from "@/lib/format";
import {
  canRequestRevision,
  deriveOrderDisplayState,
  isMockPaymentsEnabled,
  type OrderDisplayState,
} from "@/domain/checkout";
import { accountPath } from "@/lib/paths";
import OrderSteps from "@/components/account/order-steps";
import SourcePhotoUploadArea from "@/components/account/source-photo-upload-area";
import MockPaymentForm from "@/components/account/mock-payment-form";
import RevisionForm from "@/components/account/revision-form";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    title: dictionary.order.title + " | Felipe Design",
    robots: { index: false, follow: false },
  };
}

export default async function CustomerOrderPage({
  params,
}: {
  params: Promise<{ locale: string; orderId: string }>;
}) {
  const { locale, orderId } = await params;
  const current = resolve(locale);
  const dictionary = await getDictionary(current);
  const intlLocale = current === "pt" ? "pt-BR" : "en-US";

  if (!UUID_PATTERN.test(orderId)) {
    notFound();
  }

  const user = await getCurrentUser();
  if (!user) {
    const internalPath = "/" + current + "/account/orders/" + orderId;
    redirect("/" + current + "/login?next=" + encodeURIComponent(internalPath));
  }

  // RLS garante que um pedido de outro cliente simplesmente nao e retornado.
  const detail = await getCustomerOrderDetail(orderId).catch(() => null);
  if (!detail) {
    notFound();
  }

  const { order, planAngles, sourceImages, resultImages, revisions } = detail;
  const state = deriveOrderDisplayState({
    status: order.status,
    paidAt: order.paid_at,
    sourceImageCount: order.source_image_count,
    totalImages: order.total_images,
  });

  const stateLabels: Record<OrderDisplayState, string> = {
    awaiting_payment: dictionary.order.stateAwaitingPayment,
    awaiting_photos: dictionary.order.stateAwaitingPhotos,
    in_queue: dictionary.order.stateInQueue,
    in_progress: dictionary.order.stateInProgress,
    completed: dictionary.order.stateCompleted,
    cancelled: dictionary.order.stateCancelled,
  };

  const resultLinks = await Promise.all(
    resultImages.map(async (image) => ({
      id: image.id,
      filename: image.original_filename ?? image.storage_path.split("/").pop() ?? image.id,
      url: await createSignedDownloadUrl("order-results", image.storage_path),
    })),
  );

  const revisionAllowed = canRequestRevision(
    order.status,
    revisions.length,
    resultImages.length > 0,
  );

  // Source photos: thumbnails via signed URL (bucket privado client-uploads).
  const sourcePhotoItems = await Promise.all(
    sourceImages.map(async (image) => ({
      id: image.id,
      knifeIndex: image.knife_index ?? 1,
      filename: image.original_filename ?? image.storage_path.split("/").pop() ?? image.id,
      url: await createSignedDownloadUrl("client-uploads", image.storage_path),
    })),
  );

  const shortId = order.id.slice(0, 8).toUpperCase();
  const showUpload = order.status !== "cancelled" && order.status !== "completed";

  return (
    <main className="order-detail">
      <div className="account-toolbar">
        <Link href={accountPath(current)}>{dictionary.account.title}</Link>
      </div>

      <h1>
        {dictionary.account.orderNumber} #{shortId}
      </h1>
      <p className="order-subtitle">
        {order.promised_delivery_date !== null ? (
          <>
            {dictionary.order.deadlineLabel}:{" "}
            {formatDateLong(order.promised_delivery_date, intlLocale)}
            {" · "}
          </>
        ) : null}
        <span className={"badge " + state}>{stateLabels[state]}</span>
      </p>

      <OrderSteps state={state} labels={dictionary.order} />

      <section className="summary-panel">
        <h2>{dictionary.checkout.summaryTitle}</h2>
        <div className="summary-rows">
          <div className="row">
            <span>{dictionary.checkout.planLabel}</span>
            <span>
              {planAngles ?? "-"} {dictionary.services.anglesLabel}
            </span>
          </div>
          <div className="row">
            <span>{dictionary.checkout.knivesLabel}</span>
            <span>{order.knife_quantity}</span>
          </div>
          <div className="row">
            <span>{dictionary.checkout.imagesLabel}</span>
            <span>{order.total_images}</span>
          </div>
          <div className="row">
            <span>{dictionary.checkout.unitPrice}</span>
            <span>{formatMoney(order.unit_price_cents, order.currency, intlLocale)}</span>
          </div>
          <div className="row total">
            <span>{dictionary.checkout.total}</span>
            <span>{formatMoney(order.total_cents, order.currency, intlLocale)}</span>
          </div>
          <div className="row">
            <span>{dictionary.order.deadlineLabel}</span>
            <span>
              {order.promised_delivery_date !== null
                ? formatDate(order.promised_delivery_date, intlLocale)
                : dictionary.order.deadlinePending}
            </span>
          </div>
          <div className="row">
            <span>{dictionary.order.createdLabel}</span>
            <span>{formatDateTime(order.created_at, intlLocale)}</span>
          </div>
          {order.paid_at !== null ? (
            <div className="row">
              <span>{dictionary.dashboard.paidAtLabel}</span>
              <span>{formatDateTime(order.paid_at, intlLocale)}</span>
            </div>
          ) : null}
        </div>
      </section>

      {state === "awaiting_payment" ? (
        <section className="estimate-panel">
          <h2>{dictionary.order.statusTitle}</h2>
          <p className="note">{stateLabels[state]}</p>
          {isMockPaymentsEnabled() ? (
            <MockPaymentForm
              locale={current}
              orderId={order.id}
              labels={{
                simulate: dictionary.order.simulatePayment,
                simulating: dictionary.order.simulating,
                disabled: dictionary.order.mockDisabled,
                error: dictionary.common.error,
              }}
            />
          ) : null}
        </section>
      ) : null}

      {showUpload ? (
        <section className="auth-panel">
          <SourcePhotoUploadArea
            orderId={order.id}
            locale={current}
            submitted={order.source_photos_submitted_at !== null}
            knifeQuantity={order.knife_quantity}
            requiredPerKnife={order.required_source_photos_per_knife}
            maxPerKnife={order.max_source_photos_per_knife}
            maxPhotoSizeMb={order.max_source_photo_size_mb}
            images={sourcePhotoItems}
          />
        </section>
      ) : null}

      <section className="summary-panel">
        <h2>{dictionary.order.resultsTitle}</h2>
        {resultLinks.length === 0 ? (
          <p className="note">{dictionary.order.noResultsYet}</p>
        ) : (
          resultLinks.map((file) => (
            <div className="result-file" key={file.id}>
              <span className="filename">{file.filename}</span>
              {file.url !== null ? (
                <a className="btn btn-secondary" href={file.url} download>
                  {dictionary.order.download}
                </a>
              ) : (
                <span className="note">{dictionary.order.uploadError}</span>
              )}
            </div>
          ))
        )}
      </section>

      {revisions.length > 0 ? (
        <section className="summary-panel">
          <h2>{dictionary.order.revisionTitle}</h2>
          <p className="note">{dictionary.order.revisionRequested}</p>
          {revisions[0]?.notes ? <p className="note">{revisions[0].notes}</p> : null}
        </section>
      ) : revisionAllowed ? (
        <section className="summary-panel">
          <RevisionForm
            locale={current}
            orderId={order.id}
            labels={{
              title: dictionary.order.revisionTitle,
              description: dictionary.order.revisionDescription,
              notesLabel: dictionary.order.revisionNotesLabel,
              notesPlaceholder: dictionary.order.revisionNotesPlaceholder,
              submit: dictionary.order.revisionSubmit,
              error: dictionary.order.revisionError,
            }}
          />
        </section>
      ) : null}
    </main>
  );
}
