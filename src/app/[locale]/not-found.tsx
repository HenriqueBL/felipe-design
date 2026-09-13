import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container" style={{ padding: "80px 24px" }}>
      <h1>404 - Page not found / Página não encontrada</h1>
      <p>
        <Link href="/en">English</Link> · <Link href="/pt">Português</Link>
      </p>
    </main>
  );
}
