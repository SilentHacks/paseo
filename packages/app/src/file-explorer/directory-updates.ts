import type { DirectoryVersion } from "@getpaseo/protocol/messages";
import type { ExplorerDirectory, ExplorerEntry } from "@/stores/session-store";

/**
 * Merges a pushed directory observation into the explorer's listing map.
 * Returns null when nothing changed so callers can skip a store write and
 * the re-render that would follow it.
 */
export function applyDirectoryVersionToDirectories(
  directories: ReadonlyMap<string, ExplorerDirectory>,
  version: DirectoryVersion,
): Map<string, ExplorerDirectory> | null {
  switch (version.status) {
    case "ready": {
      const existing = directories.get(version.directory.path);
      if (existing && entriesEqual(existing.entries, version.directory.entries)) {
        return null;
      }
      const next = new Map(directories);
      next.set(version.directory.path, {
        path: version.directory.path,
        entries: version.directory.entries,
      });
      return next;
    }
    case "missing": {
      if (version.path === ".") {
        return directories.size === 0 ? null : new Map();
      }
      let removed = false;
      const next = new Map(directories);
      for (const key of next.keys()) {
        if (key === version.path || key.startsWith(`${version.path}/`)) {
          next.delete(key);
          removed = true;
        }
      }
      return removed ? next : null;
    }
    case "error":
      return null;
  }
}

function entriesEqual(left: ExplorerEntry[], right: ExplorerEntry[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (
      a.name !== b.name ||
      a.kind !== b.kind ||
      a.size !== b.size ||
      a.modifiedAt !== b.modifiedAt ||
      a.gitStatus !== b.gitStatus
    ) {
      return false;
    }
  }
  return true;
}
