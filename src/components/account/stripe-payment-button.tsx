"use client";

import { useState, useTransition } from "react";

export interface StripePaymentButtonLabels {
  pay: string;
  paying: string;
  error: string;
  unavailable: string;
  confirmationPending: string;
  processing: string;
  statusUnavailable: string;
}

interface StartPaymentResult {
  success: boolean;
  errorCode?: string;
  checkoutUrl?: string;
}

interface Props {
  orderId: string;
  locale: "en" | "pt";
  labels: StripePaymentButtonLabels;
  startPayment: (input: { orderId: string; locale: "en" | "pt" }) => Promise<StartPaymentResult>;
}

// CTA de pagamento real: chama a Server Action que cria/reusa o Checkout
// Session no servidor e devolve a URL; o browser nunca informa valor/moeda.
export default function StripePaymentButton({
  orderId,
  locale,
  labels,
  startPayment,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);

  function handleClick() {
    setErrorCode(null);
    startTransition(async () => {
      const result = await startPayment({ orderId, locale });
      if (result.success && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (
        result.errorCode === "PAYMENT_CONFIRMATION_PENDING" ||
        result.errorCode === "PAYMENT_PROCESSING"
      ) {
        // Pagamento já em curso: nenhuma nova cobrança deve ser iniciada
        // enquanto a confirmação/processamento estiver pendente.
        setIsBlocked(true);
      }
      setErrorCode(result.errorCode ?? "UNKNOWN");
    });
  }

  const message =
    errorCode === "CONFIGURATION"
      ? labels.unavailable
      : errorCode === "PAYMENT_STATUS_UNAVAILABLE"
        ? labels.statusUnavailable
        : errorCode === "PAYMENT_CONFIRMATION_PENDING"
          ? labels.confirmationPending
          : errorCode === "PAYMENT_PROCESSING"
            ? labels.processing
            : errorCode
              ? labels.error
              : null;

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={handleClick}
        disabled={isPending || isBlocked}
      >
        {isPending ? labels.paying : labels.pay}
      </button>
      {message !== null ? <p className="note error">{message}</p> : null}
    </div>
  );
}