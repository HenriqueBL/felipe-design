import { isAdminUser } from "@/services/auth";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { redirect } from "next/navigation";
import { listPortfolioWorks } from "@/services/portfolio-cms";
import { portfolioPublicUrl } from "@/services/portfolio";
import CmsWorkList from "@/components/dashboard/cms-work-list";
import CmsWorkEditor from "@/components/dashboard/cms-work-editor";

export default async function PortfolioAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ edit?: string; create?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const admin = await isAdminUser();
  if (!admin) {
    redirect(`/${locale}`);
  }

  const d = await getDictionary(locale === "pt" ? "pt" : "en");
  const db = d.dashboard;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const works = await listPortfolioWorks();

  // Resolve cover image URLs for each work
  const worksWithUrls = works.map((w) => ({
    ...w,
    coverUrl: w.coverMedia
      ? portfolioPublicUrl(supabaseUrl, w.coverMedia.storagePath)
      : null,
  }));

  const isEditing = !!sp.edit;
  const isCreating = !!sp.create;
  const editId = sp.edit ?? null;

  return (
    <main className="container dashboard">
      <div className="cms-toolbar">
        <div>
          <h1>{db.portfolioTitle}</h1>
          <p className="note">{db.portfolioIntro}</p>
        </div>
        {!isEditing && !isCreating && (
          <a
            href={`/${locale}/dashboard/portfolio?create=1`}
            className="btn btn-primary"
          >
            {db.cmsNewWork}
          </a>
        )}
        {(isEditing || isCreating) && (
          <a
            href={`/${locale}/dashboard/portfolio`}
            className="btn btn-secondary"
          >
            {db.cmsCancel}
          </a>
        )}
      </div>

      {(isEditing || isCreating) && (
        <CmsWorkEditor
          locale={locale}
          workId={editId}
          labels={db}
          supabaseUrl={supabaseUrl}
        />
      )}

      {!isEditing && !isCreating && (
        <CmsWorkList
          locale={locale}
          works={worksWithUrls}
          labels={db}
        />
      )}
    </main>
  );
}