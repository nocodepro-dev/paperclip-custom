import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, CloudUpload, GitBranch, RefreshCw } from "lucide-react";
import { workspaceApi } from "@/api/workspace";
import { Button } from "@/components/ui/button";
import { useToast } from "../../context/ToastContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";

type Mode = "idle" | "setup" | "import";

export function WorkspaceSettings() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [mode, setMode] = useState<Mode>("idle");
  const [remoteUrl, setRemoteUrl] = useState("");

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "Workspace" },
    ]);
  }, [setBreadcrumbs]);

  const { data: status, isLoading } = useQuery({
    queryKey: ["workspace", "status"],
    queryFn: () => workspaceApi.getStatus(),
    refetchInterval: 30_000,
  });

  const resetForm = () => {
    setMode("idle");
    setRemoteUrl("");
  };

  const initMutation = useMutation({
    mutationFn: () => workspaceApi.init(remoteUrl),
    onSuccess: () => {
      pushToast({ title: "Workspace linked", tone: "success" });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["workspace", "status"] });
    },
    onError: (err) => pushToast({ title: "Setup failed", body: String(err), tone: "error" }),
  });

  const importMutation = useMutation({
    mutationFn: () => workspaceApi.clone(remoteUrl),
    onSuccess: (result) => {
      if (!result) {
        pushToast({ title: "Import failed", tone: "error" });
        return;
      }
      const companyWord = result.imported.companies === 1 ? "company" : "companies";
      const methodSuffix =
        result.method === "archive"
          ? " (via GitHub ZIP — install git to enable future backup/sync)"
          : "";
      pushToast({
        title: "Import complete",
        body: `Imported ${result.imported.companies} ${companyWord} from GitHub${methodSuffix}`,
        tone: "success",
      });
      resetForm();
      queryClient.invalidateQueries({ queryKey: ["workspace", "status"] });
      queryClient.invalidateQueries(); // refresh everything — companies, pipelines, SOPs, etc. all changed
    },
    onError: (err) => pushToast({ title: "Import failed", body: String(err), tone: "error" }),
  });

  const syncMutation = useMutation({
    mutationFn: () => workspaceApi.sync(),
    onSuccess: (result) => {
      if (!result) {
        pushToast({ title: "Sync failed", tone: "error" });
        return;
      }
      pushToast({
        title: result.committed ? "Backup complete" : "Already up to date",
        body: result.committed
          ? `Pushed ${result.exported.companies} companies to GitHub`
          : "No changes to back up",
        tone: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["workspace", "status"] });
    },
    onError: (err) => pushToast({ title: "Sync failed", body: String(err), tone: "error" }),
  });

  if (isLoading) return <PageSkeleton />;

  const formTitle = mode === "setup" ? "Link to Git repository" : "Import workspace from GitHub";
  const formHelper =
    mode === "setup"
      ? "Start a fresh backup to a new (empty) Git repo."
      : "Clone an existing Paperclip workspace from GitHub. Public repos work without any setup (make the repo temporarily public if needed, then private again after import). Existing data on this instance stays; anything with the same name gets a numbered suffix (e.g. 'My Company 2').";
  const primaryLabel = mode === "setup" ? "Link" : "Import";
  const primaryPending = mode === "setup" ? initMutation.isPending : importMutation.isPending;
  const primaryDisabled = !remoteUrl || primaryPending;
  const onPrimaryClick = () => {
    if (mode === "setup") initMutation.mutate();
    else if (mode === "import") importMutation.mutate();
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CloudUpload className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Workspace</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Back up your entire Paperclip instance to GitHub, or import a workspace from a GitHub
          repo. All companies, pipelines, SOPs, and knowledge collections are covered.
        </p>
      </div>

      {!status?.hasRemote && mode === "idle" && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Workspace not linked</h3>
          <p className="text-sm text-muted-foreground">
            Choose one:
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              onClick={() => setMode("setup")}
              className="text-left rounded-lg border border-border hover:border-foreground/30 hover:bg-accent/30 transition-colors p-4 space-y-1"
            >
              <div className="flex items-center gap-2">
                <CloudUpload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Setup new backup</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Start fresh — push the current Paperclip state to a new (empty) Git repo.
              </p>
            </button>
            <button
              onClick={() => setMode("import")}
              className="text-left rounded-lg border border-border hover:border-foreground/30 hover:bg-accent/30 transition-colors p-4 space-y-1"
            >
              <div className="flex items-center gap-2">
                <CloudDownload className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Import from GitHub</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Clone an existing Paperclip workspace repo and restore it into this instance.
              </p>
            </button>
          </div>
        </div>
      )}

      {(mode === "setup" || mode === "import") && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">{formTitle}</h3>
          <p className="text-xs text-muted-foreground">{formHelper}</p>
          <label className="block text-sm">
            <span className="text-muted-foreground">Git remote URL</span>
            <input
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/nocodepro-dev/paperclip-workspace.git"
              className="w-full mt-1 px-3 py-1.5 text-sm bg-transparent border border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus-visible:ring-ring focus-visible:ring-[3px]"
              autoFocus
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {mode === "setup" ? (
              <>
                Paperclip uses your machine's existing git credentials (SSH key or credential
                manager). Make sure <code>git push</code> already works for this repo from your terminal.
              </>
            ) : (
              <>
                If git is installed on this machine, Paperclip will clone normally. If not, it will
                download the repo as a ZIP (public repos only — make the repo temporarily public on
                GitHub if needed, then private again after import).
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button onClick={onPrimaryClick} disabled={primaryDisabled}>
              {primaryPending ? `${primaryLabel === "Import" ? "Importing" : "Linking"}...` : primaryLabel}
            </Button>
            <Button variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status?.hasRemote && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm truncate">{status.remoteUrl}</span>
          </div>

          {status.lastCommit ? (
            <div className="text-sm text-muted-foreground">
              Last backup: {new Date(status.lastCommit.date).toLocaleString()}
              <br />
              <span className="font-mono text-xs">{status.lastCommit.sha.slice(0, 7)}</span> — {status.lastCommit.message}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No backups yet.</div>
          )}

          {status.pendingChanges > 0 && (
            <div className="text-sm text-amber-600 dark:text-amber-400">
              {status.pendingChanges} pending {status.pendingChanges === 1 ? "change" : "changes"}
            </div>
          )}

          <Button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="gap-2"
          >
            {syncMutation.isPending ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" /> Backing up...
              </>
            ) : (
              <>
                <CloudUpload className="h-4 w-4" /> Backup to GitHub
              </>
            )}
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-muted/20 p-5">
        <h3 className="text-sm font-semibold mb-1">What's included</h3>
        <ul className="text-xs text-muted-foreground space-y-0.5">
          <li>• All companies, agents, projects, tasks, and skills</li>
          <li>• All pipelines with stages</li>
          <li>• All SOPs with screenshot assets</li>
          <li>• Knowledge collection metadata (the indexed files stay on your disk)</li>
          <li>• Activity logs, cost events, heartbeat history</li>
        </ul>
      </div>

      {status?.workspaceDir && (
        <div className="text-xs text-muted-foreground">
          Workspace dir: <span className="font-mono">{status.workspaceDir}</span>
        </div>
      )}
    </div>
  );
}
