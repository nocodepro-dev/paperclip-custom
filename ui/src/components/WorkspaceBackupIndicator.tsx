import { useQuery } from "@tanstack/react-query";
import { CloudCheck, CloudOff } from "lucide-react";
import { Link } from "@/lib/router";
import { workspaceApi } from "../api/workspace";

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function WorkspaceBackupIndicator() {
  const { data: status } = useQuery({
    queryKey: ["workspace", "status"],
    queryFn: () => workspaceApi.getStatus(),
    refetchInterval: 60_000,
  });

  if (!status) return null;

  if (!status.hasRemote) {
    return (
      <Link
        to="/instance/settings/workspace"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <CloudOff className="h-3.5 w-3.5" />
        Backup not configured
      </Link>
    );
  }

  const lastBackup = status.lastCommit?.date;
  const relativeTime = lastBackup ? formatRelativeTime(new Date(lastBackup)) : "never";

  return (
    <Link
      to="/instance/settings/workspace"
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      <CloudCheck className="h-3.5 w-3.5 text-green-600" />
      Last backup: {relativeTime}
      {status.pendingChanges > 0 && (
        <span className="ml-1 text-amber-600 dark:text-amber-400">({status.pendingChanges} pending)</span>
      )}
    </Link>
  );
}
