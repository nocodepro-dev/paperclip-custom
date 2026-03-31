import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, Link } from "@/lib/router";
import {
  ArrowLeft,
  ChevronRight,
  Play,
  Plus,
  Shield,
  Sparkles,
  Trash2,
  Users,
  Pause,
  Square,
  RotateCcw,
} from "lucide-react";
import { pipelinesApi } from "../api/pipelines";
import { agentsApi } from "../api/agents";
import { companySkillsApi } from "../api/companySkills";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { InlineEntitySelector, type InlineEntityOption } from "../components/InlineEntitySelector";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { PipelineStage, PipelineRun, PipelineRunDetail } from "@paperclipai/shared";

export function PipelineDetail() {
  const { pipelineId } = useParams<{ pipelineId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchTitle, setLaunchTitle] = useState("");
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [stageDraft, setStageDraft] = useState({
    title: "",
    description: "",
    assigneeAgentId: "",
    suggestedSkillId: "",
    requiresApproval: false,
    priority: "medium",
    timeoutMinutes: "",
  });
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const companyId = selectedCompanyId!;

  const { data: pipeline, isLoading, error } = useQuery({
    queryKey: queryKeys.pipelines.detail(companyId, pipelineId!),
    queryFn: () => pipelinesApi.get(companyId, pipelineId!),
    enabled: !!companyId && !!pipelineId,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.pipelines.runs(companyId, pipelineId),
    queryFn: () => pipelinesApi.listRuns(companyId, { pipelineTemplateId: pipelineId }),
    enabled: !!companyId && !!pipelineId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const { data: skills } = useQuery({
    queryKey: queryKeys.companySkills.list(companyId),
    queryFn: () => companySkillsApi.list(companyId),
    enabled: !!companyId,
  });

  const agentOptions: InlineEntityOption[] = (agents ?? []).map((a) => ({
    id: a.id,
    label: a.name,
  }));

  const skillOptions: InlineEntityOption[] = (skills ?? []).map((s) => ({
    id: s.id,
    label: s.name,
  }));

  useEffect(() => {
    if (pipeline) {
      setBreadcrumbs([
        { label: "Pipelines", href: "/pipelines" },
        { label: pipeline.title },
      ]);
    }
  }, [pipeline, setBreadcrumbs]);

  const launchMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => pipelinesApi.launchRun(companyId, pipelineId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.runs(companyId, pipelineId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.detail(companyId, pipelineId!) });
      setLaunchOpen(false);
      setLaunchTitle("");
      pushToast({ title: "Pipeline run launched", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to launch run", body: String(err), tone: "error" });
    },
  });

  const addStageMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => pipelinesApi.createStage(companyId, pipelineId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.detail(companyId, pipelineId!) });
      setAddStageOpen(false);
      setStageDraft({ title: "", description: "", assigneeAgentId: "", suggestedSkillId: "", requiresApproval: false, priority: "medium", timeoutMinutes: "" });
      pushToast({ title: "Stage added", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to add stage", body: String(err), tone: "error" });
    },
  });

  const deleteStageMutation = useMutation({
    mutationFn: (stageId: string) => pipelinesApi.removeStage(companyId, pipelineId!, stageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.detail(companyId, pipelineId!) });
      pushToast({ title: "Stage removed", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to remove stage", body: String(err), tone: "error" });
    },
  });

  const deletePipelineMutation = useMutation({
    mutationFn: () => pipelinesApi.remove(companyId, pipelineId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.list(companyId) });
      navigate("/pipelines");
      pushToast({ title: "Pipeline deleted", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to delete pipeline", body: String(err), tone: "error" });
    },
  });

  const cancelRunMutation = useMutation({
    mutationFn: (runId: string) => pipelinesApi.cancelRun(companyId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.runs(companyId, pipelineId) });
    },
    onError: (err) => {
      pushToast({ title: "Failed to cancel run", body: String(err), tone: "error" });
    },
  });

  const pauseRunMutation = useMutation({
    mutationFn: (runId: string) => pipelinesApi.pauseRun(companyId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.runs(companyId, pipelineId) });
    },
    onError: (err) => {
      pushToast({ title: "Failed to pause run", body: String(err), tone: "error" });
    },
  });

  const resumeRunMutation = useMutation({
    mutationFn: (runId: string) => pipelinesApi.resumeRun(companyId, runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.runs(companyId, pipelineId) });
    },
    onError: (err) => {
      pushToast({ title: "Failed to resume run", body: String(err), tone: "error" });
    },
  });

  function handleAddStage() {
    if (!stageDraft.title.trim()) return;
    const nextOrder = (pipeline?.stages?.length ?? 0);
    addStageMutation.mutate({
      title: stageDraft.title.trim(),
      description: stageDraft.description.trim() || null,
      stageOrder: nextOrder,
      assigneeAgentId: stageDraft.assigneeAgentId || null,
      suggestedSkillId: stageDraft.suggestedSkillId || null,
      requiresApproval: stageDraft.requiresApproval,
      priority: stageDraft.priority,
      timeoutMinutes: stageDraft.timeoutMinutes ? Number(stageDraft.timeoutMinutes) : null,
    });
  }

  if (isLoading) return <PageSkeleton />;
  if (error || !pipeline) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error ? `Failed to load pipeline: ${String(error)}` : "Pipeline not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate("/pipelines")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold truncate">{pipeline.title}</h1>
            <StatusBadge status={pipeline.status} />
          </div>
          {pipeline.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{pipeline.description}</p>
          )}
        </div>
        <Button size="sm" onClick={() => setLaunchOpen(true)}>
          <Play className="h-4 w-4 mr-1.5" />
          Launch Run
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            if (confirm(`Delete pipeline "${pipeline.title}"?`)) {
              deletePipelineMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="stages">
        <TabsList>
          <TabsTrigger value="stages">Stages ({pipeline.stages?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="runs">Runs ({runs?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* Stages Tab */}
        <TabsContent value="stages" className="mt-4 space-y-2">
          {pipeline.stages?.length ? (
            pipeline.stages
              .sort((a, b) => a.stageOrder - b.stageOrder)
              .map((stage, idx) => (
                <StageRow
                  key={stage.id}
                  stage={stage}
                  index={idx}
                  agents={agents ?? []}
                  skills={skills ?? []}
                  onDelete={() => {
                    if (confirm(`Delete stage "${stage.title}"?`)) {
                      deleteStageMutation.mutate(stage.id);
                    }
                  }}
                />
              ))
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              No stages yet. Add stages to define the pipeline workflow.
            </p>
          )}

          {/* Add Stage */}
          {addStageOpen ? (
            <div className="border border-border rounded-lg p-4 bg-card space-y-3">
              <input
                type="text"
                placeholder="Stage title..."
                value={stageDraft.title}
                onChange={(e) => setStageDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddStage();
                  if (e.key === "Escape") setAddStageOpen(false);
                }}
                className="w-full bg-transparent text-sm font-medium placeholder:text-muted-foreground focus:outline-none"
                autoFocus
              />
              <textarea
                placeholder="Description (optional)"
                value={stageDraft.description}
                onChange={(e) => setStageDraft((d) => ({ ...d, description: e.target.value }))}
                className="w-full resize-none bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground focus:outline-none"
                rows={2}
              />
              <div className="flex items-center gap-3 flex-wrap">
                <InlineEntitySelector
                  placeholder="Agent"
                  noneLabel="No agent"
                  searchPlaceholder="Search agents..."
                  emptyMessage="No agents"
                  value={stageDraft.assigneeAgentId}
                  options={agentOptions}
                  onChange={(val) => setStageDraft((d) => ({ ...d, assigneeAgentId: val }))}
                />
                <InlineEntitySelector
                  placeholder="Skill"
                  noneLabel="No skill"
                  searchPlaceholder="Search skills..."
                  emptyMessage="No skills"
                  value={stageDraft.suggestedSkillId}
                  options={skillOptions}
                  onChange={(val) => setStageDraft((d) => ({ ...d, suggestedSkillId: val }))}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stageDraft.requiresApproval}
                    onChange={(e) => setStageDraft((d) => ({ ...d, requiresApproval: e.target.checked }))}
                    className="rounded"
                  />
                  Requires approval
                </label>
                <input
                  type="number"
                  placeholder="Timeout (min)"
                  value={stageDraft.timeoutMinutes}
                  onChange={(e) => setStageDraft((d) => ({ ...d, timeoutMinutes: e.target.value }))}
                  className="w-28 bg-transparent text-xs border border-border rounded px-2 py-1 placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={handleAddStage} disabled={!stageDraft.title.trim() || addStageMutation.isPending}>
                  {addStageMutation.isPending ? "Adding..." : "Add Stage"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddStageOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setAddStageOpen(true)} className="text-muted-foreground">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Stage
            </Button>
          )}
        </TabsContent>

        {/* Runs Tab */}
        <TabsContent value="runs" className="mt-4 space-y-2">
          {runs?.length ? (
            runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                companyId={companyId}
                expanded={expandedRunId === run.id}
                onToggle={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                onCancel={() => cancelRunMutation.mutate(run.id)}
                onPause={() => pauseRunMutation.mutate(run.id)}
                onResume={() => resumeRunMutation.mutate(run.id)}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              No runs yet. Launch a run to execute this pipeline.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* Launch Dialog */}
      <Dialog open={launchOpen} onOpenChange={setLaunchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Launch Pipeline Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <input
              type="text"
              placeholder="Run title (optional)"
              value={launchTitle}
              onChange={(e) => setLaunchTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  launchMutation.mutate({ title: launchTitle.trim() || undefined });
                }
              }}
              className="w-full bg-transparent text-sm border border-border rounded-md px-3 py-2 placeholder:text-muted-foreground focus:outline-none focus-visible:ring-ring focus-visible:ring-[3px]"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLaunchOpen(false)}>Cancel</Button>
            <Button onClick={() => launchMutation.mutate({ title: launchTitle.trim() || undefined })} disabled={launchMutation.isPending}>
              <Play className="h-4 w-4 mr-1.5" />
              {launchMutation.isPending ? "Launching..." : "Launch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StageRow({
  stage,
  index,
  agents,
  skills,
  onDelete,
}: {
  stage: PipelineStage;
  index: number;
  agents: { id: string; name: string }[];
  skills: { id: string; name: string }[];
  onDelete: () => void;
}) {
  const assignee = stage.assigneeAgentId
    ? agents.find((a) => a.id === stage.assigneeAgentId)
    : null;
  const skill = stage.suggestedSkillId
    ? skills.find((s) => s.id === stage.suggestedSkillId)
    : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-md border border-border group">
      <span className="text-xs font-mono text-muted-foreground w-6 text-center shrink-0">
        {index + 1}
      </span>
      {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0 -ml-1" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{stage.title}</span>
          {stage.requiresApproval && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-400">
              <Shield className="h-3 w-3" />
              Approval
            </span>
          )}
          {stage.parallelGroup && (
            <span className="inline-flex items-center gap-1 text-xs text-blue-400">
              <Users className="h-3 w-3" />
              {stage.parallelGroup}
            </span>
          )}
          {skill && (
            <span className="inline-flex items-center gap-1 text-xs text-purple-400">
              <Sparkles className="h-3 w-3" />
              {skill.name}
            </span>
          )}
        </div>
        {stage.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{stage.description}</p>
        )}
      </div>
      {assignee && (
        <span className="text-xs text-muted-foreground shrink-0">{assignee.name}</span>
      )}
      {stage.requiredCapability && !assignee && (
        <span className="text-xs text-muted-foreground shrink-0 italic">{stage.requiredCapability}</span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="opacity-0 group-hover:opacity-100 text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function RunRow({
  run,
  companyId,
  expanded,
  onToggle,
  onCancel,
  onPause,
  onResume,
}: {
  run: PipelineRun;
  companyId: string;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const { data: runDetail } = useQuery({
    queryKey: queryKeys.pipelines.runDetail(companyId, run.id),
    queryFn: () => pipelinesApi.getRun(companyId, run.id),
    enabled: expanded,
  });

  const isActive = run.status === "running" || run.status === "pending";
  const isPaused = run.status === "paused";

  return (
    <div className="border border-border rounded-md">
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors"
      >
        <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{run.title}</span>
            <StatusBadge status={run.status} />
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {run.startedAt ? new Date(run.startedAt).toLocaleString() : "Not started"}
        </span>
        {isActive && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" onClick={onPause} title="Pause">
              <Pause className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onCancel} title="Cancel" className="text-destructive">
              <Square className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {isPaused && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" onClick={onResume} title="Resume">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onCancel} title="Cancel" className="text-destructive">
              <Square className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Expanded stage runs */}
      {expanded && runDetail?.stageRuns && (
        <div className="border-t border-border px-4 py-3 space-y-2 bg-muted/20">
          {runDetail.stageRuns.length ? (
            runDetail.stageRuns.map((sr) => (
              <div key={sr.id} className="flex items-center gap-3 text-xs">
                <span className="font-mono text-muted-foreground w-6 text-center">
                  {sr.stage?.stageOrder != null ? sr.stage.stageOrder + 1 : "–"}
                </span>
                <span className="font-medium flex-1 truncate">{sr.stage?.title ?? "Unknown stage"}</span>
                <StatusBadge status={sr.status} />
                {sr.resolvedAgent && (
                  <span className="text-muted-foreground">{sr.resolvedAgent.name}</span>
                )}
                {sr.issue && (
                  <Link
                    to={`/issues/${sr.issue.id}`}
                    className="text-primary hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {sr.issue.identifier ?? sr.issue.title}
                  </Link>
                )}
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No stage runs yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
