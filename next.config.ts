import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // Rotas publicas semanticas em portugues mapeadas para os slugs internos.
      { source: "/pt/servicos", destination: "/pt/services" },
      { source: "/pt/finalizar", destination: "/pt/checkout" },
      { source: "/pt/conta", destination: "/pt/account" },
      { source: "/pt/conta/pedidos/:orderId", destination: "/pt/account/orders/:orderId" },
    ];
  },
};

export default nextConfig;
