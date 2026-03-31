import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useNavigate, NavLink } from "@/lib/router";
import { BookOpen } from "lucide-react";
import { docsApi } from "../api/docs";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { MarkdownBody } from "../components/MarkdownBody";
import { cn } from "../lib/utils";

export function Documentation() {
  const { slug } = useParams<{ slug?: string }>();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();

  const { data: guides, isLoading: guidesLoading } = useQuery({
    queryKey: queryKeys.docs.list(),
    queryFn: () => docsApi.list(),
  });

  // Redirect /docs to first guide
  useEffect(() => {
    if (!slug && guides?.length) {
      navigate(`/docs/${guides[0].slug}`, { replace: true });
    }
  }, [slug, guides, navigate]);

  const activeSlug = slug ?? guides?.[0]?.slug;

  const { data: guide, isLoading: guideLoading } = useQuery({
    queryKey: queryKeys.docs.detail(activeSlug!),
    queryFn: () => docsApi.get(activeSlug!),
    enabled: !!activeSlug,
  });

  useEffect(() => {
    if (guide) {
      setBreadcrumbs([
        { label: "Documentation", href: "/docs" },
        { label: guide.title },
      ]);
    } else {
      setBreadcrumbs([{ label: "Documentation" }]);
    }
  }, [guide, setBreadcrumbs]);

  if (guidesLoading) return <PageSkeleton />;

  return (
    <div className="flex h-full min-h-0">
      {/* TOC Sidebar */}
      <nav className="w-48 shrink-0 border-r border-border overflow-y-auto py-4 px-3">
        <div className="flex items-center gap-2 px-2 mb-3">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Guides
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          {(guides ?? []).map((g) => (
            <NavLink
              key={g.slug}
              to={`/docs/${g.slug}`}
              className={({ isActive }) =>
                cn(
                  "px-2 py-1.5 text-[13px] font-medium rounded-md transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )
              }
            >
              {g.title}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {guideLoading ? (
          <div className="p-8">
            <PageSkeleton />
          </div>
        ) : guide ? (
          <article className="p-8 max-w-3xl">
            <MarkdownBody>{guide.body}</MarkdownBody>
          </article>
        ) : activeSlug ? (
          <div className="p-8">
            <p className="text-sm text-destructive">Guide not found.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
