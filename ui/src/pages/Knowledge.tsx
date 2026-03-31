import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { BookOpen, FolderSearch, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { knowledgeApi } from "../api/knowledge";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { InlineEntitySelector, type InlineEntityOption } from "../components/InlineEntitySelector";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KnowledgeCollection } from "@paperclipai/shared";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function relativeTime(date: Date | string | null): string {
  if (!date) return "Never";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function Knowledge() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    sourcePath: "",
    projectId: "",
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Knowledge" }]);
  }, [setBreadcrumbs]);

  const companyId = selectedCompanyId!;

  const { data: collections, isLoading, error } = useQuery({
    queryKey: queryKeys.knowledge.list(companyId),
    queryFn: () => knowledgeApi.list(companyId),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(companyId),
    queryFn: () => projectsApi.list(companyId),
    enabled: !!selectedCompanyId,
  });

  const projectOptions: InlineEntityOption[] = (projects ?? []).map((p) => ({
    id: p.id,
    label: p.name,
  }));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => knowledgeApi.create(companyId, data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.list(companyId) });
      setComposerOpen(false);
      setDraft({ name: "", description: "", sourcePath: "", projectId: "" });
      pushToast({ title: "Collection scanned", tone: "success" });
      navigate(`/knowledge/${created.id}`);
    },
    onError: (err) => {
      pushToast({ title: "Failed to scan directory", body: String(err), tone: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => knowledgeApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.list(companyId) });
      pushToast({ title: "Collection removed", tone: "success" });
    },
  });

  function handleCreate() {
    if (!draft.name.trim() || !draft.sourcePath.trim()) return;
    createMutation.mutate({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      sourcePath: draft.sourcePath.trim(),
      sourceType: "local_path",
      projectId: draft.projectId || null,
    });
  }

  function openComposer() {
    setComposerOpen(true);
    setTimeout(() => nameInputRef.current?.focus(), 50);
  }

  if (isLoading) return <PageSkeleton />;
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Failed to load knowledge: {String(error)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Knowledge</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Index reference directories so agents can discover and retrieve documents on demand.
          </p>
        </div>
        <Button onClick={openComposer} size="sm">
          <FolderSearch className="h-4 w-4 mr-1.5" />
          Scan Directory
        </Button>
      </div>

      {/* Composer */}
      {composerOpen && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-3">
          <input
            ref={nameInputRef}
            type="text"
            placeholder="Collection name..."
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setComposerOpen(false);
            }}
            className="w-full bg-transparent text-sm font-medium placeholder:text-muted-foreground focus:outline-none"
          />
          <input
            type="text"
            placeholder="Directory path (e.g. /path/to/references)"
            value={draft.sourcePath}
            onChange={(e) => setDraft((d) => ({ ...d, sourcePath: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCreate();
              }
            }}
            className="w-full bg-transparent text-sm font-mono placeholder:text-muted-foreground focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Description (optional)"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="flex-1 bg-transparent text-xs border border-border rounded px-2 py-1 placeholder:text-muted-foreground focus:outline-none"
            />
            <InlineEntitySelector
              placeholder="Project"
              noneLabel="No project"
              searchPlaceholder="Search projects..."
              emptyMessage="No projects"
              value={draft.projectId}
              options={projectOptions}
              onChange={(val) => setDraft((d) => ({ ...d, projectId: val }))}
            />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!draft.name.trim() || !draft.sourcePath.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Scanning..." : "Scan & Index"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setComposerOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {!collections?.length && !composerOpen ? (
        <EmptyState icon={BookOpen} message="No knowledge collections yet" action="Scan Directory" onAction={openComposer} />
      ) : (
        <div className="flex flex-col gap-1">
          {(collections ?? []).map((col) => (
            <CollectionRow
              key={col.id}
              collection={col}
              onNavigate={() => navigate(`/knowledge/${col.id}`)}
              onDelete={() => {
                if (confirm(`Remove index "${col.name}"? Files on disk are not affected.`)) {
                  deleteMutation.mutate(col.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionRow({
  collection,
  onNavigate,
  onDelete,
}: {
  collection: KnowledgeCollection;
  onNavigate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onNavigate}
      className="flex items-center gap-3 px-4 py-3 rounded-md border border-border hover:bg-accent/50 cursor-pointer transition-colors group"
    >
      <BookOpen className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{collection.name}</span>
          <StatusBadge status={collection.status} />
        </div>
        <p className="text-xs font-mono text-muted-foreground truncate mt-0.5">
          {collection.sourcePath}
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
        <span>{collection.entryCount} files</span>
        <span>{formatBytes(collection.totalBytes)}</span>
        <span title={collection.lastScannedAt ? new Date(collection.lastScannedAt).toLocaleString() : "Never scanned"}>
          {relativeTime(collection.lastScannedAt)}
        </span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Remove Index
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
