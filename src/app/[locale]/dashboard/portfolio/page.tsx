import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdminUser } from "@/services/auth";
import { getDictionary } from "@/lib/i18n/dictionaries";
import PortfolioCreateForm from "@/components/dashboard/portfolio-create-form";
import PortfolioItemForm from "@/components/dashboard/portfolio-item-form";
import { redirect } from "next/navigation";
import type { PortfolioItemRow } from "@/types/database";
import { resolvePortfolioMedia, portfolioPublicUrl } from "@/services/portfolio";

export default async function PortfolioAdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await createSupabaseServerClient();
  const admin = await isAdminUser();
  if (!admin) {
    redirect(`/${locale}`);
  }

  const d = await getDictionary(locale === "pt" ? "pt" : "en");
  const db = d.dashboard;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const { data: items } = await supabase
    .from("portfolio_items")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  return (
    <main className="container dashboard">
      <h1>{db.portfolioTitle}</h1>
      <p className="note">{db.portfolioIntro}</p>

      <PortfolioCreateForm
        locale={locale}
        labels={{
          title: db.portfolioAddTitle,
          itemTitle: db.portfolioItemTitle,
          description: db.portfolioItemDescription,
          image: db.portfolioItemImage,
          imageHint: db.portfolioItemImageHint,
          sortOrder: db.portfolioItemSortOrder,
          published: db.portfolioItemPublished,
          button: db.portfolioAddButton,
          pending: db.portfolioAdding,
          // Action code i18n labels (mapped from state.code)
          forbidden: db.portfolioActionForbidden,
          invalidInput: db.portfolioActionInvalidInput,
          imageRequired: db.portfolioActionImageRequired,
          imageInvalid: db.portfolioActionImageInvalid,
          createFailed: db.portfolioActionCreateFailed,
          updateFailed: db.portfolioActionUpdateFailed,
          publishFailed: db.portfolioActionPublishFailed,
          featuredFailed: db.portfolioActionFeaturedFailed,
          clearFeaturedFailed: db.portfolioActionClearFeaturedFailed,
          reorderFailed: db.portfolioActionReorderFailed,
          notFound: db.portfolioActionNotFound,
          deleteFailed: db.portfolioActionDeleteFailed,
          created: db.portfolioActionCreated,
          updated: db.portfolioActionUpdated,
          publishedAction: db.portfolioActionPublished,
          unpublished: db.portfolioActionUnpublished,
          featuredSet: db.portfolioActionFeaturedSet,
          featuredCleared: db.portfolioActionFeaturedCleared,
          reordered: db.portfolioActionReordered,
          deleted: db.portfolioActionDeleted,
        }}
      />

      <section className="panel">
        <h2>{db.portfolioTitle}</h2>
        {(items?.length ?? 0) === 0 ? (
          <p className="note">{db.portfolioEmpty}</p>
        ) : (
          <div className="portfolio-list">
            {items!.map((item) => (
              <PortfolioItemForm
                key={item.id}
                locale={locale}
                item={item as PortfolioItemRow}
                imageUrl={(() => {
                  const mediaPath = resolvePortfolioMedia({
                    imageStoragePath: item.image_storage_path,
                    beforeStoragePath: item.before_storage_path,
                    afterStoragePath: item.after_storage_path,
                  });
                  return mediaPath ? portfolioPublicUrl(supabaseUrl, mediaPath) : null;
                })()}
                labels={{
                  itemTitle: db.portfolioItemTitle,
                  description: db.portfolioItemDescription,
                  image: db.portfolioItemImage,
                  imageHint: db.portfolioItemImageHint,
                  sortOrder: db.portfolioItemSortOrder,
                  published: db.portfolioItemPublished,
                  unpublished: db.portfolioActionUnpublished,
                  featured: db.portfolioItemFeatured,
                  featuredSet: db.portfolioActionFeaturedSet,
                  featuredCleared: db.portfolioActionFeaturedCleared,
                  save: db.portfolioUpdateButton,
                  saving: db.portfolioUpdating,
                  updated: db.portfolioActionUpdated,
                  reordered: db.portfolioActionReordered,
                  deleted: db.portfolioActionDeleted,
                  error: db.saveError,
                  publish: db.portfolioPublish,
                  unpublish: db.portfolioUnpublish,
                  setFeatured: db.portfolioSetFeatured,
                  removeFeatured: db.portfolioRemoveFeatured,
                  moveUp: db.portfolioMoveUp,
                  moveDown: db.portfolioMoveDown,
                  delete: db.portfolioDelete,
                  deleteConfirm: db.portfolioDeleteConfirm,
                  // Action code i18n labels (mapped from state.code)
                  forbidden: db.portfolioActionForbidden,
                  invalidInput: db.portfolioActionInvalidInput,
                  imageRequired: db.portfolioActionImageRequired,
                  imageInvalid: db.portfolioActionImageInvalid,
                  createFailed: db.portfolioActionCreateFailed,
                  updateFailed: db.portfolioActionUpdateFailed,
                  publishFailed: db.portfolioActionPublishFailed,
                  featuredFailed: db.portfolioActionFeaturedFailed,
                  clearFeaturedFailed: db.portfolioActionClearFeaturedFailed,
                  reorderFailed: db.portfolioActionReorderFailed,
                  notFound: db.portfolioActionNotFound,
                  deleteFailed: db.portfolioActionDeleteFailed,
                  created: db.portfolioActionCreated,
                  publishedAction: db.portfolioActionPublished,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}