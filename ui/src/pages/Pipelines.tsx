import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { Plus, Workflow, Trash2, MoreHorizontal } from "lucide-react";
import { pipelinesApi } from "../api/pipelines";
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
import type { PipelineTemplate } from "@paperclipai/shared";

function autoResizeTextarea(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = "auto";
  element.style.height = `${element.scrollHeight}px`;
}

export function Pipelines() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const projectSelectorRef = useRef<HTMLButtonElement | null>(null);

  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", projectId: "" });

  useEffect(() => {
    setBreadcrumbs([{ label: "Pipelines" }]);
  }, [setBreadcrumbs]);

  const { data: pipelines, isLoading, error } = useQuery({
    queryKey: queryKeys.pipelines.list(selectedCompanyId!),
    queryFn: () => pipelinesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const projectOptions: InlineEntityOption[] = (projects ?? []).map((p) => ({
    id: p.id,
    label: p.name,
  }));

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => pipelinesApi.create(selectedCompanyId!, data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.list(selectedCompanyId!) });
      setComposerOpen(false);
      setDraft({ title: "", description: "", projectId: "" });
      pushToast({ title: "Pipeline created", tone: "success" });
      navigate(`/pipelines/${created.id}`);
    },
    onError: (err) => {
      pushToast({ title: "Failed to create pipeline", body: String(err), tone: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => pipelinesApi.remove(selectedCompanyId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.list(selectedCompanyId!) });
      pushToast({ title: "Pipeline deleted", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to delete pipeline", body: String(err), tone: "error" });
    },
  });

  function handleCreate() {
    if (!draft.title.trim()) return;
    createMutation.mutate({
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      projectId: draft.projectId || null,
    });
  }

  function openComposer() {
    setComposerOpen(true);
    setTimeout(() => titleInputRef.current?.focus(), 50);
  }

  if (isLoading) return <PageSkeleton />;
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Failed to load pipelines: {String(error)}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sequential agent orchestration — define stages, assign agents, launch runs.
          </p>
        </div>
        <Button onClick={openComposer} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Pipeline
        </Button>
      </div>

      {/* Composer */}
      {composerOpen && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-3">
          <textarea
            ref={(el) => {
              titleInputRef.current = el;
              autoResizeTextarea(el);
            }}
            placeholder="Pipeline title..."
            value={draft.title}
            onChange={(e) => {
              setDraft((d) => ({ ...d, title: e.target.value }));
              autoResizeTextarea(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCreate();
              }
              if (e.key === "Escape") setComposerOpen(false);
            }}
            className="w-full resize-none bg-transparent text-sm font-medium placeholder:text-muted-foreground focus:outline-none"
            rows={1}
          />
          <textarea
            placeholder="Description (optional)"
            value={draft.description}
            onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            className="w-full resize-none bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={2}
          />
          <div className="flex items-center gap-2">
            <InlineEntitySelector
              ref={projectSelectorRef}
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
            <Button size="sm" onClick={handleCreate} disabled={!draft.title.trim() || createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Pipeline"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setComposerOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {!pipelines?.length && !composerOpen ? (
        <EmptyState icon={Workflow} message="No pipelines yet" action="New Pipeline" onAction={openComposer} />
      ) : (
        <div className="flex flex-col gap-1">
          {(pipelines ?? []).map((pipeline) => (
            <PipelineRow
              key={pipeline.id}
              pipeline={pipeline}
              onNavigate={() => navigate(`/pipelines/${pipeline.id}`)}
              onDelete={() => {
                if (confirm(`Delete pipeline "${pipeline.title}"?`)) {
                  deleteMutation.mutate(pipeline.id);
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineRow({
  pipeline,
  onNavigate,
  onDelete,
}: {
  pipeline: PipelineTemplate;
  onNavigate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onNavigate}
      className="flex items-center gap-3 px-4 py-3 rounded-md border border-border hover:bg-accent/50 cursor-pointer transition-colors group"
    >
      <Workflow className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{pipeline.title}</span>
          <StatusBadge status={pipeline.status} />
        </div>
        {pipeline.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{pipeline.description}</p>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {new Date(pipeline.createdAt).toLocaleDateString()}
      </span>
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
