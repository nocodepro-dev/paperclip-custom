import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@/lib/router";
import {
  ArrowLeft,
  BookOpen,
  Download,
  ExternalLink,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { knowledgeApi } from "../api/knowledge";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { PageSkeleton } from "../components/PageSkeleton";
import { StatusBadge } from "../components/StatusBadge";
import { MarkdownBody } from "../components/MarkdownBody";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KnowledgeEntry, KnowledgeEntryKind } from "@paperclipai/shared";

const ENTRY_KINDS: KnowledgeEntryKind[] = [
  "document",
  "design_system",
  "schema",
  "screenshot",
  "flow",
  "brief",
  "sop",
  "asset",
  "other",
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function kindLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

function isImageContentType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function isMarkdownContentType(contentType: string): boolean {
  return contentType === "text/markdown" || contentType === "text/x-markdown";
}

function isJsonContentType(contentType: string): boolean {
  return contentType === "application/json";
}

function isTextContentType(contentType: string): boolean {
  return contentType.startsWith("text/");
}

export function KnowledgeDetail() {
  const { collectionId } = useParams<{ collectionId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const companyId = selectedCompanyId!;

  const { data: collection, isLoading, error } = useQuery({
    queryKey: queryKeys.knowledge.detail(collectionId!),
    queryFn: () => knowledgeApi.get(collectionId!),
    enabled: !!collectionId,
  });

  useEffect(() => {
    if (collection) {
      setBreadcrumbs([
        { label: "Knowledge", href: "/knowledge" },
        { label: collection.name },
      ]);
    }
  }, [collection, setBreadcrumbs]);

  const rescanMutation = useMutation({
    mutationFn: () => knowledgeApi.rescan(collectionId!),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.detail(collectionId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.list(companyId) });
      pushToast({
        title: "Rescan complete",
        body: `Added ${result.added}, changed ${result.changed}, removed ${result.removed}, unchanged ${result.unchanged}`,
        tone: "success",
      });
    },
    onError: (err) => {
      pushToast({ title: "Rescan failed", body: String(err), tone: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => knowledgeApi.remove(collectionId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.knowledge.list(companyId) });
      navigate("/knowledge");
      pushToast({ title: "Collection removed", tone: "success" });
    },
  });

  const filteredEntries = useMemo(() => {
    if (!collection?.entries) return [];
    let entries = collection.entries;
    if (kindFilter) {
      entries = entries.filter((e) => e.kind === kindFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.relativePath.toLowerCase().includes(q) ||
          (e.summary && e.summary.toLowerCase().includes(q)),
      );
    }
    return entries;
  }, [collection?.entries, kindFilter, searchQuery]);

  const kindCounts = useMemo(() => {
    if (!collection?.entries) return {};
    const counts: Record<string, number> = {};
    for (const entry of collection.entries) {
      counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    }
    return counts;
  }, [collection?.entries]);

  if (isLoading) return <PageSkeleton />;
  if (error || !collection) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          {error ? `Failed to load collection: ${String(error)}` : "Collection not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate("/knowledge")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold truncate">{collection.name}</h1>
            <StatusBadge status={collection.status} />
          </div>
          {collection.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{collection.description}</p>
          )}
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="font-mono">{collection.sourcePath}</span>
            <span>{collection.entryCount} files</span>
            <span>{formatBytes(collection.totalBytes)}</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => rescanMutation.mutate()}
          disabled={rescanMutation.isPending}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${rescanMutation.isPending ? "animate-spin" : ""}`} />
          {rescanMutation.isPending ? "Scanning..." : "Rescan"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            if (confirm(`Remove index "${collection.name}"? Files on disk are not affected.`)) {
              deleteMutation.mutate();
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="entries">
        <TabsList>
          <TabsTrigger value="entries">Entries ({collection.entries?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>

        {/* Entries Tab */}
        <TabsContent value="entries" className="mt-4 space-y-3">
          {/* Search + Kind Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search entries..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-transparent border border-border rounded-md placeholder:text-muted-foreground focus:outline-none focus-visible:ring-ring focus-visible:ring-[3px]"
              />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={() => setKindFilter(null)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  !kindFilter
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-accent/50"
                }`}
              >
                All
              </button>
              {ENTRY_KINDS.filter((k) => kindCounts[k]).map((kind) => (
                <button
                  key={kind}
                  onClick={() => setKindFilter(kindFilter === kind ? null : kind)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    kindFilter === kind
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {kindLabel(kind)} ({kindCounts[kind]})
                </button>
              ))}
            </div>
          </div>

          {/* Entry Table */}
          {filteredEntries.length ? (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-accent/20 text-left">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Path</th>
                    <th className="px-3 py-2 font-medium">Kind</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium text-right">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      expanded={expandedEntryId === entry.id}
                      onToggle={() =>
                        setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id)
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">
              {searchQuery || kindFilter ? "No matching entries." : "No entries in this collection."}
            </p>
          )}
        </TabsContent>

        {/* Info Tab */}
        <TabsContent value="info" className="mt-4">
          <div className="border border-border rounded-lg p-4 bg-card space-y-2">
            <PropertyRow label="Source Type" value={collection.sourceType} />
            <PropertyRow label="Source Path" value={collection.sourcePath} mono />
            <PropertyRow label="Auto Discover" value={collection.autoDiscover ? "Yes" : "No"} />
            <PropertyRow label="Status" value={collection.status} />
            <PropertyRow
              label="Last Scanned"
              value={collection.lastScannedAt ? new Date(collection.lastScannedAt).toLocaleString() : "Never"}
            />
            <PropertyRow label="Entries" value={String(collection.entryCount)} />
            <PropertyRow label="Total Size" value={formatBytes(collection.totalBytes)} />
            <PropertyRow label="Created" value={new Date(collection.createdAt).toLocaleString()} />
            <PropertyRow label="Updated" value={new Date(collection.updatedAt).toLocaleString()} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PropertyRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function EntryRow({
  entry,
  expanded,
  onToggle,
}: {
  entry: KnowledgeEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-t border-border cursor-pointer hover:bg-accent/30 transition-colors"
      >
        <td className="px-3 py-2 font-medium">{entry.name}</td>
        <td className="px-3 py-2 font-mono text-muted-foreground truncate max-w-[200px]">
          {entry.relativePath}
        </td>
        <td className="px-3 py-2">
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted/50 text-muted-foreground">
            {kindLabel(entry.kind)}
          </span>
        </td>
        <td className="px-3 py-2 text-muted-foreground">{entry.contentType}</td>
        <td className="px-3 py-2 text-right text-muted-foreground">{formatBytes(entry.byteSize)}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} className="px-3 py-3 bg-muted/10 border-t border-border">
            <EntryPreview entry={entry} />
          </td>
        </tr>
      )}
    </>
  );
}

function EntryPreview({ entry }: { entry: KnowledgeEntry }) {
  const contentUrl = knowledgeApi.entryContentUrl(entry.id);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);

  const isImage = isImageContentType(entry.contentType);
  const isMarkdown = isMarkdownContentType(entry.contentType);
  const isJson = isJsonContentType(entry.contentType);
  const isText = isTextContentType(entry.contentType);

  useEffect(() => {
    if ((isMarkdown || isJson || isText) && entry.byteSize < 500_000) {
      setLoadingText(true);
      fetch(contentUrl)
        .then((res) => res.text())
        .then((text) => {
          setTextContent(text);
          setLoadingText(false);
        })
        .catch(() => setLoadingText(false));
    }
  }, [contentUrl, isMarkdown, isJson, isText, entry.byteSize]);

  return (
    <div className="space-y-2">
      {entry.summary && (
        <p className="text-xs text-muted-foreground">{entry.summary}</p>
      )}

      {/* Content Preview */}
      {isImage && (
        <img
          src={contentUrl}
          alt={entry.name}
          className="max-w-full max-h-64 rounded-md border border-border"
        />
      )}

      {isMarkdown && textContent && (
        <div className="border border-border rounded-md p-4 bg-card max-h-80 overflow-y-auto">
          <MarkdownBody>{textContent}</MarkdownBody>
        </div>
      )}

      {isJson && textContent && (
        <pre className="border border-border rounded-md p-3 bg-neutral-950 text-xs font-mono text-foreground max-h-80 overflow-auto">
          {textContent}
        </pre>
      )}

      {isText && !isMarkdown && !isJson && textContent && (
        <pre className="border border-border rounded-md p-3 bg-muted/30 text-xs font-mono max-h-80 overflow-auto">
          {textContent}
        </pre>
      )}

      {loadingText && (
        <p className="text-xs text-muted-foreground">Loading content...</p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <a
          href={contentUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          View raw
        </a>
        <a
          href={contentUrl}
          download={entry.name}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Download className="h-3 w-3" />
          Download
        </a>
      </div>
    </div>
  );
}
