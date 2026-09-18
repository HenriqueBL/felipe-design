import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// CSP compativel com Supabase Auth/Storage (TUS resumable incluido) e Next.js.
// - 'unsafe-inline' em script-src/style-src: exigido pelo bootstrap/hydratacao do Next.js
//   (sem nonce por request em headers estaticos de next.config.ts).
// - 'unsafe-eval' em script-src apenas em dev (React Fast Refresh).
// - connect-src inclui a URL do Supabase (fetch + XHR do tus-js-client).
// - img-src inclui o dominio do Supabase (thumbnails via signed URLs) e blob:/data:
//   (previews locais antes do upload concluir).
const isDev = process.env.NODE_ENV === "development";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data:${supabaseUrl ? ` ${supabaseUrl}` : ""}`,
  `connect-src 'self'${supabaseUrl ? ` ${supabaseUrl} ${supabaseUrl.replace("https://", "wss://")}` : ""}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Saida standalone: server.js autonomo para a imagem Docker de producao.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      // Rotas publicas semanticas em portugues mapeadas para os slugs internos.
      { source: "/pt/servicos", destination: "/pt/services" },
      { source: "/pt/sobre", destination: "/pt/about" },
      { source: "/pt/galeria", destination: "/pt/gallery" },
      { source: "/pt/finalizar", destination: "/pt/checkout" },
      { source: "/pt/conta", destination: "/pt/account" },
      { source: "/pt/conta/pedidos/:orderId", destination: "/pt/account/orders/:orderId" },
    ];
  },
};

export default nextConfig;
