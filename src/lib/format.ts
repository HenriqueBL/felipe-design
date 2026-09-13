import type { Currency, OrderStatus } from "@/types/database";

export function formatMoney(amountCents: number, currency: Currency, locale: string): string {
  const intlCurrency = currency === "BRL" ? "BRL" : "USD";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: intlCurrency,
  }).format(amountCents / 100);
}

export function formatDate(value: string, locale: string): string {
  const date = new Date(value + "T00:00:00Z");
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatDateTime(value: string, locale: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function orderStatusLabel(status: OrderStatus, locale: string): string {
  if (locale === "pt") {
    return status === "pending"
      ? "Pendente"
      : status === "in_progress"
        ? "Em andamento"
        : status === "completed"
          ? "Concluído"
          : "Cancelado";
  }
  return status === "pending"
    ? "Pending"
    : status === "in_progress"
      ? "In progress"
      : status === "completed"
        ? "Completed"
        : "Cancelled";
}
