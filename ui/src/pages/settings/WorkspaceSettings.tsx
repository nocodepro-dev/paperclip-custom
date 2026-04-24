import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudUpload, GitBranch, RefreshCw } from "lucide-react";
import { workspaceApi } from "@/api/workspace";
import { Button } from "@/components/ui/button";
import { useToast } from "../../context/ToastContext";
import { useBreadcrumbs } from "../../context/BreadcrumbContext";
import { PageSkeleton } from "../../components/PageSkeleton";

export function WorkspaceSettings() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [showSetup, setShowSetup] = useState(false);
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

  const initMutation = useMutation({
    mutationFn: () => workspaceApi.init(remoteUrl),
    onSuccess: () => {
      pushToast({ title: "Workspace linked", tone: "success" });
      setShowSetup(false);
      setRemoteUrl("");
      queryClient.invalidateQueries({ queryKey: ["workspace", "status"] });
    },
    onError: (err) => pushToast({ title: "Setup failed", body: String(err), tone: "error" }),
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

  return (
    <div className="max-w-3xl space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <CloudUpload className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Workspace</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Back up your entire Paperclip instance to GitHub. All companies, pipelines, SOPs,
          and knowledge collections are exported to a Git repository you control.
        </p>
      </div>

      {!status?.hasRemote && !showSetup && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold mb-2">Workspace not linked</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Link this Paperclip instance to a Git repository to enable one-click backups.
          </p>
          <Button onClick={() => setShowSetup(true)}>Setup Workspace Backup</Button>
        </div>
      )}

      {showSetup && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="text-sm font-semibold">Link to Git repository</h3>
          <label className="block text-sm">
            <span className="text-muted-foreground">Git remote URL</span>
            <input
              type="text"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
              placeholder="https://github.com/nocodepro-dev/paperclip-workspace.git"
              className="w-full mt-1 px-3 py-1.5 text-sm bg-transparent border border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus-visible:ring-ring focus-visible:ring-[3px]"
            />
          </label>
          <div className="flex gap-2">
            <Button
              onClick={() => initMutation.mutate()}
              disabled={!remoteUrl || initMutation.isPending}
            >
              {initMutation.isPending ? "Linking..." : "Link"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowSetup(false);
                setRemoteUrl("");
              }}
            >
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
