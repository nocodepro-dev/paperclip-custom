import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, Link } from "@/lib/router";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  Image,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { sopsApi } from "../api/sops";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { MarkdownBody } from "../components/MarkdownBody";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { SOPConversionResult } from "@paperclipai/shared";

export function SOPDetail() {
  const { sopId } = useParams<{ sopId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [convertOpen, setConvertOpen] = useState(false);
  const [convertMode, setConvertMode] = useState<"auto" | "review">("review");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const companyId = selectedCompanyId!;

  const { data: sop, isLoading, error } = useQuery({
    queryKey: queryKeys.sops.detail(sopId!),
    queryFn: () => sopsApi.get(sopId!),
    enabled: !!sopId,
  });

  const { data: conversion } = useQuery({
    queryKey: queryKeys.sops.conversion(sopId!),
    queryFn: () => sopsApi.getConversion(sopId!),
    enabled: !!sopId && (sop?.status === "converting" || sop?.status === "converted"),
    retry: false,
  });

  useEffect(() => {
    if (sop) {
      setBreadcrumbs([
        { label: "SOPs", href: "/sops" },
        { label: sop.name },
      ]);
    }
  }, [sop, setBreadcrumbs]);

  const activateMutation = useMutation({
    mutationFn: () => sopsApi.update(sopId!, { status: "active" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.detail(sopId!) });
      pushToast({ title: "SOP activated", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to activate SOP", body: String(err), tone: "error" });
    },
  });

  const convertMutation = useMutation({
    mutationFn: (mode: "auto" | "review") => sopsApi.startConversion(sopId!, mode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.detail(sopId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.conversion(sopId!) });
      setConvertOpen(false);
      pushToast({ title: "Conversion started", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Conversion failed", body: String(err), tone: "error" });
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => sopsApi.approveConversion(sopId!),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.detail(sopId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.conversion(sopId!) });
      pushToast({ title: "Skill created from SOP", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Approval failed", body: String(err), tone: "error" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (feedback: string) => sopsApi.rejectConversion(sopId!, feedback),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.detail(sopId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.conversion(sopId!) });
      setRejectOpen(false);
      setRejectFeedback("");
      pushToast({ title: "Conversion rejected", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to reject conversion", body: String(err), tone: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => sopsApi.remove(sopId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sops.list(companyId) });
      navigate("/sops");
      pushToast({ title: "SOP deleted", tone: "success" });
    },
    onError: (err) => {
      pushToast({ title: "Failed to delete SOP", body: String(err), tone: "error" });
    },
  });

  if (isLoading) return <PageSkeleton />;
  if (error || !sop) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error ? `Failed to load SOP: ${String(error)}` : "SOP not found"}
        </p>
      </div>
    );
  }

  const hasAssets = sop.assets && sop.assets.length > 0;

  return (
    <div className="flex flex-col gap-4 p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate("/sops")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold truncate">{sop.name}</h1>
            <StatusBadge status={sop.status} />
            {sop.category && (
              <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                {sop.category}
              </span>
            )}
          </div>
          {sop.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{sop.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span>Source: {sop.sourceType}</span>
            {sop.screenshotCount > 0 && (
              <span className="flex items-center gap-1">
                <Image className="h-3 w-3" />
                {sop.screenshotCount} screenshots
              </span>
            )}
          </div>
        </div>

        {/* Action buttons based on status */}
        <div className="flex items-center gap-2 shrink-0">
          {sop.status === "draft" && (
            <Button size="sm" onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending}>
              {activateMutation.isPending ? "Activating..." : "Activate"}
            </Button>
          )}
          {sop.status === "active" && (
            <Button size="sm" onClick={() => setConvertOpen(true)}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              Convert to Skill
            </Button>
          )}
          {sop.generatedSkillId && (
            <Link to={`/skills/${sop.generatedSkillId}`}>
              <Button size="sm" variant="secondary">
                View Skill
              </Button>
            </Link>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => {
              if (confirm(`Delete SOP "${sop.name}"?`)) {
                deleteMutation.mutate();
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="content">
        <TabsList>
          <TabsTrigger value="content">Content</TabsTrigger>
          {hasAssets && <TabsTrigger value="assets">Assets ({sop.assets.length})</TabsTrigger>}
          {(conversion || sop.status === "converting" || sop.status === "converted") && (
            <TabsTrigger value="conversion">Conversion</TabsTrigger>
          )}
        </TabsList>

        {/* Content Tab */}
        <TabsContent value="content" className="mt-4">
          <div className="border border-border rounded-lg p-6 bg-card">
            <MarkdownBody>{sop.markdownBody}</MarkdownBody>
          </div>
        </TabsContent>

        {/* Assets Tab */}
        {hasAssets && (
          <TabsContent value="assets" className="mt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {sop.assets.map((asset) => {
                const src = sopsApi.assetContentUrl(sop.id, asset.id);
                return (
                  <div
                    key={asset.id}
                    onClick={() => setLightboxSrc(src)}
                    className="border border-border rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-ring transition-all group"
                  >
                    <div className="aspect-video bg-muted/30 flex items-center justify-center">
                      {asset.kind === "screenshot" || asset.kind === "reference" ? (
                        <img
                          src={src}
                          alt={asset.relativePath}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileText className="h-8 w-8 text-muted-foreground/50" />
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-xs text-muted-foreground truncate">{asset.relativePath}</p>
                      {asset.stepNumber != null && (
                        <p className="text-xs font-medium">Step {asset.stepNumber}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </TabsContent>
        )}

        {/* Conversion Tab */}
        {(conversion || sop.status === "converting" || sop.status === "converted") && (
          <TabsContent value="conversion" className="mt-4 space-y-4">
            <ConversionPanel
              conversion={conversion ?? null}
              onApprove={() => approveMutation.mutate()}
              onReject={() => setRejectOpen(true)}
              approving={approveMutation.isPending}
            />
          </TabsContent>
        )}
      </Tabs>

      {/* Convert Dialog */}
      <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convert SOP to Skill</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Analyze this SOP and generate a skill definition that agents can execute.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium">Conversion mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setConvertMode("review")}
                  className={`flex-1 border rounded-md px-3 py-2 text-sm text-left transition-colors ${
                    convertMode === "review"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <span className="font-medium">Review</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Generate draft for your approval before creating skill
                  </p>
                </button>
                <button
                  onClick={() => setConvertMode("auto")}
                  className={`flex-1 border rounded-md px-3 py-2 text-sm text-left transition-colors ${
                    convertMode === "auto"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-accent/50"
                  }`}
                >
                  <span className="font-medium">Auto</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically create skill without review step
                  </p>
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConvertOpen(false)}>Cancel</Button>
            <Button onClick={() => convertMutation.mutate(convertMode)} disabled={convertMutation.isPending}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {convertMutation.isPending ? "Starting..." : "Start Conversion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Conversion</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Provide feedback so the conversion can be improved and re-run.
            </p>
            <textarea
              placeholder="What needs to change..."
              value={rejectFeedback}
              onChange={(e) => setRejectFeedback(e.target.value)}
              className="w-full resize-y bg-muted/30 text-sm rounded-md p-3 placeholder:text-muted-foreground focus:outline-none focus-visible:ring-ring focus-visible:ring-[3px] min-h-[80px]"
              rows={3}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate(rejectFeedback)}
              disabled={!rejectFeedback.trim() || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lightbox */}
      {lightboxSrc && (
        <Dialog open onOpenChange={() => setLightboxSrc(null)}>
          <DialogContent className="max-w-4xl p-0 overflow-hidden">
            <img src={lightboxSrc} alt="Asset preview" className="w-full h-auto" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ConversionPanel({
  conversion,
  onApprove,
  onReject,
  approving,
}: {
  conversion: SOPConversionResult | null;
  onApprove: () => void;
  onReject: () => void;
  approving: boolean;
}) {
  if (!conversion) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card">
        <p className="text-sm text-muted-foreground">Conversion data not available.</p>
      </div>
    );
  }

  const score = Math.round(conversion.automationScore * 100);

  return (
    <div className="space-y-4">
      {/* Automation Score */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Automation Score</span>
          <span className="text-sm font-bold">{score}%</span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              score >= 80 ? "bg-green-400" : score >= 50 ? "bg-yellow-400" : "bg-red-400"
            }`}
            style={{ width: `${score}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {conversion.stepAnalysis.filter((s) => s.automatable).length} of {conversion.stepAnalysis.length} steps can be automated
        </p>
      </div>

      {/* Step Analysis Table */}
      {conversion.stepAnalysis.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-accent/20 text-left">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Human Action</th>
                <th className="px-3 py-2 font-medium">Tool</th>
                <th className="px-3 py-2 font-medium text-center">Auto</th>
                <th className="px-3 py-2 font-medium text-center">Tool Avail</th>
                <th className="px-3 py-2 font-medium text-center">Approval</th>
              </tr>
            </thead>
            <tbody>
              {conversion.stepAnalysis.map((step) => (
                <tr key={step.stepNumber} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{step.stepNumber}</td>
                  <td className="px-3 py-2">{step.humanAction}</td>
                  <td className="px-3 py-2 text-muted-foreground">{step.toolRequired ?? "—"}</td>
                  <td className="px-3 py-2 text-center">
                    {step.automatable ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400 inline" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-400 inline" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {step.toolAvailable ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400 inline" />
                    ) : step.toolRequired ? (
                      <XCircle className="h-3.5 w-3.5 text-yellow-400 inline" />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {step.requiresApproval ? (
                      <span className="text-amber-400 font-medium">Yes</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Draft Skill Preview + Actions */}
      {conversion.status === "draft_ready" && conversion.draftSkillMarkdown && (
        <div className="space-y-3">
          <div className="border border-border rounded-lg p-4 bg-card">
            <h3 className="text-sm font-semibold mb-3">Generated Skill Preview</h3>
            <div className="bg-muted/30 rounded-md p-4 max-h-96 overflow-y-auto">
              <MarkdownBody>{conversion.draftSkillMarkdown}</MarkdownBody>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onApprove} disabled={approving}>
              <Check className="h-4 w-4 mr-1.5" />
              {approving ? "Creating Skill..." : "Approve & Create Skill"}
            </Button>
            <Button variant="destructive" onClick={onReject}>
              <X className="h-4 w-4 mr-1.5" />
              Reject
            </Button>
          </div>
        </div>
      )}

      {conversion.status === "approved" && conversion.generatedSkillId && (
        <div className="border border-green-500/20 bg-green-500/5 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
            <span className="text-sm font-medium">Skill created successfully</span>
          </div>
          <Link to={`/skills/${conversion.generatedSkillId}`} className="text-sm text-primary hover:underline mt-1 inline-block">
            View generated skill →
          </Link>
        </div>
      )}

      {conversion.status === "analyzing" && (
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Analyzing SOP steps...</span>
          </div>
        </div>
      )}
    </div>
  );
}
