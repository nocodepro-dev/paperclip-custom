import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { FileText, Image, Link2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { sopsApi } from "../api/sops";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CompanySop } from "@paperclipai/shared";

function autoResizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export function SOPs() {
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
    category: "",
    markdownBody: "",
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "SOPs" }]);
  }, [setBreadcrumbs]);

  const { data: sops, isLoading, error } = useQuery({
    queryKey: queryKeys.sops.list(selectedCompanyId!),
    queryFn: () => sopsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => sopsApi.create(selectedCompanyId!, data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.list(selectedCompanyId!) });
      setComposerOpen(false);
      setDraft({ name: "", description: "", category: "", markdownBody: "" });
      pushToast({ title: "SOP created", tone: "success" });
      navigate(`/sops/${created.id}`);
    },
    onError: (err) => {
      pushToast({ title: "Failed to create SOP", body: String(err), tone: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => sopsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.list(selectedCompanyId!) });
      pushToast({ title: "SOP deleted", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to delete SOP", body: String(err), tone: "error" });
    },
  });

  function handleCreate() {
    if (!draft.name.trim() || !draft.markdownBody.trim()) return;
    createMutation.mutate({
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      category: draft.category.trim() || null,
      markdownBody: draft.markdownBody,
      sourceType: "upload",
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
        <p className="text-sm text-destructive">Failed to load SOPs: {String(error)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">SOPs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Standard operating procedures — capture human workflows, convert to agent skills.
          </p>
        </div>
        <Button onClick={openComposer} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New SOP
        </Button>
      </div>

      {/* Composer */}
      {composerOpen && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-3">
          <input
            ref={nameInputRef}
            type="text"
            placeholder="SOP name..."
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setComposerOpen(false);
            }}
            className="w-full bg-transparent text-sm font-medium placeholder:text-muted-foreground focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Category (optional)"
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
              className="bg-transparent text-xs border border-border rounded px-2 py-1 placeholder:text-muted-foreground focus:outline-none w-40"
            />
            <input
              type="text"
              placeholder="Description (optional)"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              className="flex-1 bg-transparent text-xs border border-border rounded px-2 py-1 placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <textarea
            placeholder="Paste the SOP markdown content here..."
            value={draft.markdownBody}
            onChange={(e) => setDraft((d) => ({ ...d, markdownBody: e.target.value }))}
            className="w-full resize-y bg-muted/30 text-sm font-mono rounded-md p-3 placeholder:text-muted-foreground focus:outline-none min-h-[120px]"
            rows={6}
          />
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!draft.name.trim() || !draft.markdownBody.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create SOP"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setComposerOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {!sops?.length && !composerOpen ? (
        <EmptyState icon={FileText} message="No SOPs yet" action="New SOP" onAction={openComposer} />
      ) : (
        <div className="flex flex-col gap-1">
          {(sops ?? []).map((sop) => (
            <SopRow
              key={sop.id}
              sop={sop}
              onNavigate={() => navigate(`/sops/${sop.id}`)}
              onDelete={() => {
                if (confirm(`Delete SOP "${sop.name}"?`)) {
                  deleteMutation.mutate(sop.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SopRow({
  sop,
  onNavigate,
  onDelete,
}: {
  sop: CompanySop;
  onNavigate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onNavigate}
      className="flex items-center gap-3 px-4 py-3 rounded-md border border-border hover:bg-accent/50 cursor-pointer transition-colors group"
    >
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{sop.name}</span>
          <StatusBadge status={sop.status} />
          {sop.category && (
            <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              {sop.category}
            </span>
          )}
        </div>
        {sop.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{sop.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {sop.screenshotCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Image className="h-3 w-3" />
            {sop.screenshotCount}
          </span>
        )}
        {sop.generatedSkillId && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <Link2 className="h-3 w-3" />
            Skill
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {new Date(sop.createdAt).toLocaleDateString()}
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
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
