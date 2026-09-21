export const PORTFOLIO_BUCKET = "portfolio";

/** URL publica de um objeto do bucket portfolio (leitura publica). */
export function portfolioPublicUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${PORTFOLIO_BUCKET}/${path}`;
}