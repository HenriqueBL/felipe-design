import { getCurrentUser, isAdminUserAdmin } from "@/services/auth";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { redirect } from "next/navigation";
import { listPortfolioWorksAdmin } from "@/services/portfolio-cms";
import { portfolioPublicUrl } from "@/services/portfolio";
import CmsWorkList from "@/components/dashboard/cms-work-list";
import CmsWorkEditor from "@/components/dashboard/cms-work-editor";

/**
 * Strip functions from the dashboard dictionary before passing to client components.
 * Next.js RSC cannot serialize functions across the server/client boundary unless
 * marked with "use server". The dashboard dict contains helper functions like
 * stripeSecretKeyHint that are only used server-side.
 */
function stripFunctions<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "function") return undefined as unknown as T;
  if (Array.isArray(obj)) return obj.map(stripFunctions) as unknown as T;
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value !== "function") {
        result[key] = stripFunctions(value);
      }
    }
    return result as T;
  }
  return obj;
}

export default async function PortfolioAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ edit?: string; create?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/${locale}`);
  }
  const admin = await isAdminUserAdmin(user.id);
  if (!admin) {
    redirect(`/${locale}`);
  }

  const d = await getDictionary(locale === "pt" ? "pt" : "en");
  const db = stripFunctions(d.dashboard);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const works = await listPortfolioWorksAdmin();
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