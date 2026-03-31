import { useQuery } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { queryKeys } from "../lib/queryKeys";

const SKILL_REQUEST_TYPES = ["skill_access_request", "skill_creation_request"];

export function useSkillRequestBadge(companyId: string | null | undefined): number {
  const { data } = useQuery({
    queryKey: queryKeys.approvals.skillRequests(companyId!),
    queryFn: () => approvalsApi.list(companyId!, { types: SKILL_REQUEST_TYPES }),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  return (data ?? []).filter(
    (a) => a.status === "pending" || a.status === "revision_requested",
  ).length;
}
