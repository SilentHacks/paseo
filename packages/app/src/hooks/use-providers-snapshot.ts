import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AgentProvider, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useReplicaQuery } from "@/data/query";
import { queryClient as singletonQueryClient } from "@/data/query-client";
import {
  normalizeProvidersSnapshotCwd,
  providersSnapshotQueryKey,
  providersSnapshotQueryRoot,
  fetchProvidersSnapshot,
  refreshAndApplyProvidersSnapshot,
} from "@/data/providers-snapshot";

export {
  providersSnapshotQueryKey,
  providersSnapshotQueryRoot,
  fetchProvidersSnapshot,
  refreshAndApplyProvidersSnapshot,
};

export type ProvidersSnapshotClient = Pick<
  DaemonClient,
  "getProvidersSnapshot" | "refreshProvidersSnapshot"
>;

interface UseProvidersSnapshotResult {
  entries: ProviderSnapshotEntry[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isRefreshing: boolean;
  error: string | null;
  supportsSnapshot: boolean;
  refresh: (providers?: AgentProvider[]) => Promise<void>;
  refetch: () => void;
}

interface UseProvidersSnapshotOptions {
  enabled?: boolean;
  cwd?: string | null;
}

export function useProvidersSnapshot(
  serverId: string | null,
  options: UseProvidersSnapshotOptions = {},
): UseProvidersSnapshotResult {
  const { t } = useTranslation();
  const retainedPanelActive = useRetainedPanelActive();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const enabled = (options.enabled ?? true) && retainedPanelActive;
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const cwd = normalizeProvidersSnapshotCwd(options.cwd);
  const supportsSnapshot = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.providersSnapshot === true,
  );

  const queryKey = useMemo(() => providersSnapshotQueryKey(serverId, cwd), [cwd, serverId]);

  const snapshotQuery = useReplicaQuery({
    queryKey,
    // The content-hash cache already owns catalog and model identity.
    structuralSharing: false,
    enabled: Boolean(enabled && supportsSnapshot && serverId && client && isConnected),
    pushEvent: "providers_snapshot_update",
    queryFn: async ({ signal }) => {
      if (!client || !serverId) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return fetchProvidersSnapshot({ client, serverId, cwd, queryClient, signal });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async (providers?: AgentProvider[]) => {
      if (!client || !serverId) {
        return;
      }
      await refreshAndApplyProvidersSnapshot({
        client,
        queryClient,
        serverId,
        cwd,
        providers,
      });
    },
  });
  const { mutateAsync: refreshSnapshot, isPending: isRefreshing } = refreshMutation;

  const refresh = useCallback(
    async (providers?: AgentProvider[]) => {
      await refreshSnapshot(providers);
    },
    [refreshSnapshot],
  );

  // Replica queries never go stale (staleTime: Infinity), so gating this on
  // `stale: true` made selector-open refetches a permanent no-op. The response
  // carries ifNoneMatch, so an unconditional refetch stays cheap when unchanged.
  const refetch = useCallback(() => {
    void queryClient.refetchQueries({ queryKey, type: "active" });
  }, [queryClient, queryKey]);

  return {
    entries: snapshotQuery.data?.entries ?? undefined,
    isLoading: snapshotQuery.isLoading,
    isFetching: snapshotQuery.isFetching,
    isRefreshing,
    error: snapshotQuery.error instanceof Error ? snapshotQuery.error.message : null,
    supportsSnapshot,
    refresh,
    refetch,
  };
}

export function prefetchProvidersSnapshot(
  serverId: string,
  client: DaemonClient,
  options: { cwd?: string | null } = {},
): void {
  const cwd = normalizeProvidersSnapshotCwd(options.cwd);
  const queryKey = providersSnapshotQueryKey(serverId, cwd);
  void singletonQueryClient.prefetchQuery({
    queryKey,
    staleTime: Infinity,
    structuralSharing: false,
    queryFn: ({ signal }) =>
      fetchProvidersSnapshot({ client, serverId, cwd, queryClient: singletonQueryClient, signal }),
  });
}
