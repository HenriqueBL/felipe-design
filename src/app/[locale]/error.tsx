"use client";

import { usePathname } from "next/navigation";

const messages = {
  en: {
    title: "Something went wrong",
    retry: "Try again",
  },
  pt: {
    title: "Algo deu errado",
    retry: "Tentar novamente",
  },
} as const;

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);
  const pathname = usePathname() ?? "/en";
  const locale = pathname.startsWith("/pt") ? "pt" : "en";
  const t = messages[locale];

  return (
    <div className="container" style={{ padding: "80px 24px", textAlign: "center" }}>
      <h1>{t.title}</h1>
      <button type="button" className="btn btn-secondary" onClick={() => reset()}>
        {t.retry}
      </button>
    </div>
  );
}