import { useEffect, useRef } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { DirectoryVersion } from "@getpaseo/protocol/messages";

interface DirectoryWatchParams {
  client: DaemonClient | null;
  cwd: string | null;
  enabled: boolean;
  active: boolean;
  expandedPaths: ReadonlySet<string>;
  onVersion: (version: DirectoryVersion) => void;
}

interface DirectorySubscriptionHandle {
  release(): void;
}

function releaseAll(subscriptions: Map<string, DirectorySubscriptionHandle>): void {
  for (const handle of subscriptions.values()) {
    handle.release();
  }
  subscriptions.clear();
}

/**
 * Keeps one `fs.directory.subscribe` observation per expanded directory while
 * the explorer pane is on screen and the daemon supports it. Pushed versions
 * are handed to `onVersion`, which merges them into the explorer store — the
 * same merge the pull path uses, minus loading states.
 *
 * The subscription unit is a single directory on purpose: the daemon watches
 * exactly what is displayed, so watcher cost tracks the viewport rather than
 * the worktree. Releasing on `active=false` also hands reconnect/restore
 * freshness to the subscription's replayed `initial` snapshot.
 */
export function useExplorerDirectoryWatch({
  client,
  cwd,
  enabled,
  active,
  expandedPaths,
  onVersion,
}: DirectoryWatchParams): void {
  const subscriptionsRef = useRef(new Map<string, DirectorySubscriptionHandle>());
  const onVersionRef = useRef(onVersion);
  onVersionRef.current = onVersion;

  const eligible = enabled && active && client !== null && cwd !== null;

  useEffect(() => {
    const subscriptions = subscriptionsRef.current;
    if (!eligible || !client || !cwd) {
      releaseAll(subscriptions);
      return;
    }
    for (const [path, handle] of subscriptions) {
      if (!expandedPaths.has(path)) {
        handle.release();
        subscriptions.delete(path);
      }
    }
    for (const path of expandedPaths) {
      if (subscriptions.has(path)) continue;
      subscriptions.set(
        path,
        startDirectorySubscription(client, cwd, path, (version) => onVersionRef.current(version)),
      );
    }
  }, [client, cwd, eligible, expandedPaths]);

  useEffect(() => {
    const subscriptions = subscriptionsRef.current;
    return () => releaseAll(subscriptions);
  }, []);
}

function startDirectorySubscription(
  client: DaemonClient,
  cwd: string,
  path: string,
  onVersion: (version: DirectoryVersion) => void,
): DirectorySubscriptionHandle {
  const controller = new AbortController();
  let released = false;
  let unsubscribe: (() => Promise<void>) | null = null;
  void (async () => {
    try {
      const subscription = await client.subscribeDirectory(
        { cwd, path, signal: controller.signal },
        onVersion,
      );
      if (released) {
        await subscription.unsubscribe();
      } else {
        unsubscribe = subscription.unsubscribe;
      }
    } catch {
      // A directory that cannot be watched (already gone, permission, watch
      // limit) keeps its pull-fetched listing; manual refresh still works.
    }
  })();
  return {
    release() {
      if (released) return;
      released = true;
      controller.abort();
      if (unsubscribe) void unsubscribe();
    },
  };
}
