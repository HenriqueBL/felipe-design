import { getDictionary } from "@/lib/i18n/dictionaries";
import { defaultLocale, isLocale, type Locale } from "@/lib/i18n/config";
import { requireEnv } from "@/lib/env";
import {
  listAllPortfolioItems,
  portfolioPublicUrl,
} from "@/services/portfolio";
import PortfolioCreateForm from "@/components/dashboard/portfolio-create-form";
import PortfolioItemForm from "@/components/dashboard/portfolio-item-form";

export default async function DashboardPortfolioPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const current: Locale = isLocale(locale) ? locale : defaultLocale;
  const dictionary = await getDictionary(current);
  const d = dictionary.dashboard;

  const items = await listAllPortfolioItems();
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");

  return (
    <div>
      <h1>{d.portfolioTitle}</h1>
      <p className="note">{d.portfolioIntro}</p>

      <PortfolioCreateForm
        locale={current}
        labels={{
          title: d.portfolioAddTitle,
          itemTitle: d.portfolioItemTitle,
          description: d.portfolioItemDescription,
          image: d.portfolioItemImage,
          imageHint: d.portfolioItemImageHint,
          sortOrder: d.portfolioItemSortOrder,
          published: d.portfolioItemPublished,
          button: d.portfolioAddButton,
          pending: d.portfolioAdding,
          success: d.portfolioAdded,
          error: d.saveError,
        }}
      />

      {items.length === 0 ? (
        <p className="note">{d.portfolioEmpty}</p>
      ) : (
        items.map((item) => (
          <PortfolioItemForm
            key={item.id}
            locale={current}
            item={item}
            imageUrl={
              item.image_storage_path
                ? portfolioPublicUrl(supabaseUrl, item.image_storage_path)
                : null
            }
            labels={{
              itemTitle: d.portfolioItemTitle,
              description: d.portfolioItemDescription,
              image: d.portfolioItemImage,
              imageHint: d.portfolioItemImageHint,
              sortOrder: d.portfolioItemSortOrder,
              published: d.portfolioItemPublished,
              featured: d.portfolioItemFeatured,
              save: d.portfolioUpdateButton,
              saving: d.portfolioUpdating,
              error: d.saveError,
              publish: d.portfolioPublish,
              unpublish: d.portfolioUnpublish,
              setFeatured: d.portfolioSetFeatured,
              removeFeatured: d.portfolioRemoveFeatured,
              moveUp: d.portfolioMoveUp,
              moveDown: d.portfolioMoveDown,
              delete: d.portfolioDelete,
              deleteConfirm: d.portfolioDeleteConfirm,
            }}
          />
        ))
      )}
    </div>
  );
}