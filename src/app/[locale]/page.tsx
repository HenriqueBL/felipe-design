import Image from "next/image";
import Link from "next/link";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { servicesPath, galleryPath, aboutPath } from "@/lib/paths";
import { publicPath, siteUrl } from "@/lib/site";
import {
  getFeaturedPortfolioItem,
  listPublishedPortfolioItems,
  portfolioPublicUrl,
} from "@/services/portfolio";
import { listPlans, type PlanWithPrices } from "@/services/plans";

// Fallback versionado do hero: a Home nunca quebra por falta de destaque.
const HERO_FALLBACK_SRC = "/home/hero-fallback.svg";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);

  const featured = await getFeaturedPortfolioItem();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  // Usa resolvedMediaPath (image → after → before) para suportar itens
  // novos e legacy sem duplicar paths artificialmente.
  const heroSrc =
    featured && featured.resolvedMediaPath && supabaseUrl
      ? portfolioPublicUrl(supabaseUrl, featured.resolvedMediaPath)
      : HERO_FALLBACK_SRC;
  const heroAlt = featured ? featured.title : dictionary.home.heroTitle;

  // Fetch published items for Selected Work section
  const publishedItems = await listPublishedPortfolioItems();
  const selectedWork = publishedItems.slice(0, 6);

  // Fetch plans for Services preview
  const plans = await listPlans();
  const currency = current === "pt" ? "BRL" : "USD";

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Felipe Design",
    url: siteUrl() + publicPath(current, "home"),
    description: dictionary.meta.description,
    inLanguage: current === "pt" ? "pt-BR" : "en",
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
      />

      {/* ─── CINEMATIC HERO ─────────────────────────────────────── */}
      <section className="cinematic-hero">
        <div className="cinematic-hero-media">
          <Image
            src={heroSrc}
            alt={heroAlt}
            fill
            priority
            sizes="100vw"
            className="cinematic-hero-img"
            style={{ objectFit: "cover", objectPosition: "center 30%" }}
          />
          <div className="cinematic-hero-overlay" aria-hidden="true" />
          <div className="cinematic-hero-gradient" aria-hidden="true" />
        </div>
        <div className="container cinematic-hero-content">
          <p className="cinematic-eyebrow">
            {current === "pt" ? "FOTOGRAFIA DE FACAS, REFINADA." : "KNIFE PHOTOGRAPHY, REFINED."}
          </p>
          <h1>{dictionary.home.heroTitle}</h1>
          <p className="cinematic-hero-subtitle">{dictionary.home.heroSubtitle}</p>
          <div className="cinematic-hero-actions">
            <Link href={servicesPath(current)} className="btn btn-primary btn-lg">
              {dictionary.home.ctaPrimary}
            </Link>
            <Link href={galleryPath(current)} className="btn btn-ghost btn-lg">
              {dictionary.home.ctaSecondary}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── FEATURED WORK ──────────────────────────────────────── */}
      {featured && (
        <section className="section cinematic-featured-work">
          <div className="container">
            <p className="section-eyebrow">
              {current === "pt" ? "Trabalho em Destaque" : "Featured Work"}
            </p>
            <div className="cinematic-featured-grid">
              <div className="cinematic-featured-image">
                {featured.resolvedMediaPath && supabaseUrl && (
                  <Image
                    src={portfolioPublicUrl(supabaseUrl, featured.resolvedMediaPath)}
                    alt={featured.title}
                    width={900}
                    height={600}
                    sizes="(max-width: 900px) 100vw, 900px"
                    className="cinematic-featured-img"
                  />
                )}
              </div>
              <div className="cinematic-featured-text">
                <h2>{featured.title}</h2>
                {featured.description && <p>{featured.description}</p>}
                <Link href={galleryPath(current)} className="btn btn-secondary">
                  {current === "pt" ? "Ver Galeria Completa" : "View Full Gallery"}
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ─── THE PROCESS ────────────────────────────────────────── */}
      <section className="section cinematic-process">
        <div className="container">
          <p className="section-eyebrow">
            {current === "pt" ? "O Processo" : "The Process"}
          </p>
          <h2>
            {current === "pt"
              ? "Da Imagem Bruta à Obra-Prima"
              : "From Raw Image to Masterpiece"}
          </h2>
          <div className="cinematic-process-steps">
            <div className="cinematic-step">
              <span className="cinematic-step-number">01</span>
              <h3>{current === "pt" ? "Fotografia" : "Photography"}</h3>
              <p>
                {current === "pt"
                  ? "Captura profissional com iluminação controlada e composição precisa."
                  : "Professional capture with controlled lighting and precise composition."}
              </p>
            </div>
            <div className="cinematic-step">
              <span className="cinematic-step-number">02</span>
              <h3>{current === "pt" ? "Retoque" : "Retouching"}</h3>
              <p>
                {current === "pt"
                  ? "Edição meticulosa de cor, contraste e detalhes para realçar cada lâmina."
                  : "Meticulous color, contrast and detail editing to enhance every blade."}
              </p>
            </div>
            <div className="cinematic-step">
              <span className="cinematic-step-number">03</span>
              <h3>{current === "pt" ? "Entrega" : "Delivery"}</h3>
              <p>
                {current === "pt"
                  ? "Arquivos em alta resolução prontos para catálogo, redes sociais ou impressão."
                  : "High-resolution files ready for catalog, social media or print."}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SERVICES PREVIEW ───────────────────────────────────── */}
      <section className="section cinematic-services-preview">
        <div className="container">
          <p className="section-eyebrow">
            {current === "pt" ? "Serviços" : "Services"}
          </p>
          <h2>
            {current === "pt"
              ? "Escolha Seu Pacote"
              : "Choose Your Package"}
          </h2>
          <div className="cinematic-services-grid">
            {plans.map((plan: PlanWithPrices, idx: number) => {
              const price = plan.prices.find((p: { currency: string }) => p.currency === currency);
              return (
                <div key={plan.id} className="cinematic-service-card">
                  <span className="cinematic-service-number">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <h3>
                    {plan.angles} {plan.angles === 1 ? (current === "pt" ? "Ângulo" : "Angle") : (current === "pt" ? "Ângulos" : "Angles")}
                  </h3>
                  {price && (
                    <p className="cinematic-service-price">
                      {currency === "BRL" ? "R$" : "$"}
                      {" "}
                      {(price.amount_cents / 100).toFixed(currency === "BRL" ? 2 : 0)}
                    </p>
                  )}
                  <p className="cinematic-service-desc">
                    {current === "pt"
                      ? `Pacote profissional de ${plan.angles} ângulo${plan.angles > 1 ? "s" : ""}.`
                      : `Professional ${plan.angles}-angle package.`}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="cinematic-services-cta">
            <Link href={servicesPath(current)} className="btn btn-primary">
              {current === "pt" ? "Ver Todos os Serviços" : "View All Services"}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── SELECTED WORK ──────────────────────────────────────── */}
      {selectedWork.length > 0 && (
        <section className="section cinematic-selected-work">
          <div className="container">
            <p className="section-eyebrow">
              {current === "pt" ? "Trabalhos Selecionados" : "Selected Work"}
            </p>
            <h2>
              {current === "pt"
                ? "Portfólio Recente"
                : "Recent Portfolio"}
            </h2>
            <div className="cinematic-gallery-grid">
              {selectedWork.map((item) => (
                <figure key={item.id} className="cinematic-gallery-item">
                  {item.resolvedMediaPath && supabaseUrl && (
                    <Image
                      src={portfolioPublicUrl(supabaseUrl, item.resolvedMediaPath)}
                      alt={item.title}
                      width={600}
                      height={400}
                      sizes="(max-width: 600px) 100vw, 600px"
                      className="cinematic-gallery-img"
                    />
                  )}
                  <figcaption>{item.title}</figcaption>
                </figure>
              ))}
            </div>
            <div className="cinematic-gallery-cta">
              <Link href={galleryPath(current)} className="btn btn-secondary">
                {current === "pt" ? "Ver Galeria Completa" : "View Full Gallery"}
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ─── ABOUT TEASER ───────────────────────────────────────── */}
      <section className="section cinematic-about-teaser">
        <div className="container">
          <div className="cinematic-about-content">
            <p className="section-eyebrow">
              {current === "pt" ? "Sobre Felipe" : "About Felipe"}
            </p>
            <h2>
              {current === "pt"
                ? "Mais de 5 Anos de Excelência Visual"
                : "Over 5 Years of Visual Excellence"}
            </h2>
            <p>
              {current === "pt"
                ? "Especialista em fotografia e retoque de facas artesanais, com trabalhos publicados na BLADE Magazine e participação no Legacy of Steel II."
                : "Specialist in handcrafted knife photography and retouching, with work published in BLADE Magazine and featured in Legacy of Steel II."}
            </p>
            <Link href={aboutPath(current)} className="btn btn-ghost">
              {current === "pt" ? "Saiba Mais" : "Learn More"}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ──────────────────────────────────────────── */}
      <section className="section cinematic-final-cta">
        <div className="container">
          <h2>
            {current === "pt"
              ? "Pronto para Elevar Suas Imagens?"
              : "Ready to Elevate Your Images?"}
          </h2>
          <p>
            {current === "pt"
              ? "Transforme suas fotos de facas em peças de arte visual."
              : "Transform your knife photos into visual art pieces."}
          </p>
          <Link href={servicesPath(current)} className="btn btn-primary btn-lg">
            {dictionary.home.ctaPrimary}
          </Link>
        </div>
      </section>
    </main>
  );
}