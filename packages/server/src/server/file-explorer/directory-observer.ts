import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { DirectoryVersion } from "@getpaseo/protocol/messages";
import { isMissingEntryError, listDirectoryEntries, resolveExplorerFilePath } from "./service.js";
import { expandUserPath } from "../path-utils.js";

const DIRECTORY_DEBOUNCE_MS = 150;
const DIRECTORY_FALLBACK_POLL_MS = 5_000;
const MAX_OBSERVED_DIRECTORIES = 512;

interface DirectoryWatch {
  close(): void;
}

export interface DirectoryObserverDependencies {
  watchDirectory(
    directory: string,
    onChange: (filename: string | null) => void,
    onError: () => void,
  ): DirectoryWatch;
  setTimeout(callback: () => void | Promise<void>, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  setInterval(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

interface ObservedDirectory {
  cwd: string;
  path: string;
  basename: string;
  listeners: Map<(version: DirectoryVersion) => void, { cwd: string; path: string }>;
  fingerprint: string | null;
  watcher: DirectoryWatch | null;
  parentWatcher: DirectoryWatch | null;
  debounce: ReturnType<typeof setTimeout> | null;
  fallback: ReturnType<typeof setInterval> | null;
  restating: boolean;
  restatQueued: boolean;
}

const nodeDependencies: DirectoryObserverDependencies = {
  watchDirectory(directory, onChange, onError) {
    const watcher: FSWatcher = watch(directory, (_event, filename) => {
      onChange(filename === null ? null : filename.toString());
    });
    watcher.on("error", onError);
    return watcher;
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};

/**
 * Shallow observation of one directory's membership per subscription key.
 * Watching only displayed directories bounds the watcher count by the
 * viewport instead of the tree — the recursive file-observer module is for
 * worktree-wide consumers (workspace git), not per-pane listing freshness.
 *
 * Two watches serve one directory: the directory itself reports membership
 * changes, and its parent reports the directory's own rename or deletion,
 * which produces no event on the directory watch. For "." the parent is
 * outside the workspace scope, so self-loss relies on the watcher error
 * path and Node's self-rename event instead.
 */
export class DirectoryObserver {
  private readonly dependencies: DirectoryObserverDependencies;
  private readonly observed = new Map<string, ObservedDirectory>();

  constructor(dependencies: DirectoryObserverDependencies = nodeDependencies) {
    this.dependencies = dependencies;
  }

  async subscribe(
    input: { cwd: string; path: string },
    listener: (version: DirectoryVersion) => void,
  ): Promise<{ initial: DirectoryVersion; unsubscribe: () => void }> {
    const target = await resolveExplorerFilePath({ root: input.cwd, relativePath: input.path });
    let observed = this.observed.get(target);
    if (!observed) {
      if (this.observed.size >= MAX_OBSERVED_DIRECTORIES) {
        return {
          initial: {
            status: "error",
            cwd: expandUserPath(input.cwd),
            path: input.path,
            error: "Directory watch limit reached",
          },
          unsubscribe: () => {},
        };
      }
      const initial = await getExplorerDirectoryVersion(input);
      observed = this.observed.get(target);
      if (!observed) {
        observed = {
          cwd: input.cwd,
          path: input.path,
          basename: path.basename(target),
          listeners: new Map(),
          fingerprint: null,
          watcher: null,
          parentWatcher: null,
          debounce: null,
          fallback: null,
          restating: false,
          restatQueued: false,
        };
        this.observed.set(target, observed);
        observed.fingerprint = fingerprint(initial);
        this.startWatching(target, observed);
      }
    }
    const initial = await getExplorerDirectoryVersion(input);
    observed.listeners.set(listener, { cwd: initial.cwd, path: initial.path });
    observed.fingerprint = fingerprint(initial);

    let active = true;
    return {
      initial,
      unsubscribe: () => {
        if (!active) return;
        active = false;
        observed?.listeners.delete(listener);
        if (observed && observed.listeners.size === 0) {
          this.stopWatching(observed);
          this.observed.delete(target);
        }
      },
    };
  }

  dispose(): void {
    for (const observed of this.observed.values()) {
      this.stopWatching(observed);
    }
    this.observed.clear();
  }

  private startWatching(target: string, observed: ObservedDirectory): void {
    this.armDirectoryWatch(target, observed);
    const parent = path.dirname(target);
    if (parent !== target && observed.path !== ".") {
      try {
        observed.parentWatcher = this.dependencies.watchDirectory(
          parent,
          (filename) => {
            if (filename === null || filename === observed.basename) {
              this.scheduleRestat(target, observed);
            }
          },
          () => {
            observed.parentWatcher?.close();
            observed.parentWatcher = null;
            this.useFallback(target, observed);
          },
        );
      } catch {
        this.useFallback(target, observed);
      }
    }
    this.useFallback(target, observed);
  }

  private armDirectoryWatch(target: string, observed: ObservedDirectory): void {
    if (observed.watcher) return;
    try {
      observed.watcher = this.dependencies.watchDirectory(
        target,
        () => this.scheduleRestat(target, observed),
        () => {
          observed.watcher?.close();
          observed.watcher = null;
          this.useFallback(target, observed);
        },
      );
    } catch {
      observed.watcher = null;
    }
  }

  private useFallback(target: string, observed: ObservedDirectory): void {
    if (observed.fallback) return;
    // Only the directory's own watch sees membership changes; a surviving
    // parent watch alone cannot report files added or removed inside it.
    if (observed.watcher) return;
    observed.fallback = this.dependencies.setInterval(
      () => this.restate(target, observed),
      DIRECTORY_FALLBACK_POLL_MS,
    );
  }

  private scheduleRestat(target: string, observed: ObservedDirectory): void {
    if (observed.debounce) {
      this.dependencies.clearTimeout(observed.debounce);
    }
    observed.debounce = this.dependencies.setTimeout(() => {
      observed.debounce = null;
      return this.restate(target, observed);
    }, DIRECTORY_DEBOUNCE_MS);
  }

  private async restate(target: string, observed: ObservedDirectory): Promise<void> {
    if (observed.restating) {
      observed.restatQueued = true;
      return;
    }
    observed.restating = true;
    try {
      do {
        observed.restatQueued = false;
        if (this.observed.get(target) !== observed) return;
        const version = await getExplorerDirectoryVersion(observed);
        if (version.status === "ready" && !observed.watcher) {
          this.armDirectoryWatch(target, observed);
          if (observed.watcher && observed.fallback) {
            this.dependencies.clearInterval(observed.fallback);
            observed.fallback = null;
          }
        }
        const nextFingerprint = fingerprint(version);
        if (nextFingerprint === observed.fingerprint) continue;
        observed.fingerprint = nextFingerprint;
        for (const [listener, identity] of observed.listeners) {
          listener({ ...version, ...identity } as DirectoryVersion);
        }
      } while (observed.restatQueued);
    } finally {
      observed.restating = false;
    }
  }

  private stopWatching(observed: ObservedDirectory): void {
    observed.watcher?.close();
    observed.parentWatcher?.close();
    if (observed.debounce) this.dependencies.clearTimeout(observed.debounce);
    if (observed.fallback) this.dependencies.clearInterval(observed.fallback);
    observed.watcher = null;
    observed.parentWatcher = null;
    observed.debounce = null;
    observed.fallback = null;
  }
}

async function getExplorerDirectoryVersion(input: {
  cwd: string;
  path: string;
}): Promise<DirectoryVersion> {
  const cwd = expandUserPath(input.cwd);
  try {
    const directory = await listDirectoryEntries({
      root: input.cwd,
      relativePath: input.path,
    });
    return { status: "ready", cwd, path: directory.path, directory };
  } catch (error) {
    if (isMissingEntryError(error)) {
      return { status: "missing", cwd, path: input.path };
    }
    return {
      status: "error",
      cwd,
      path: input.path,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function fingerprint(version: DirectoryVersion): string {
  if (version.status !== "ready") {
    return version.status === "error" ? `error:${version.error}` : "missing";
  }
  return version.directory.entries
    .map(
      (entry) =>
        `${entry.name}:${entry.kind}:${entry.size}:${entry.modifiedAt}:${entry.gitStatus ?? ""}`,
    )
    .join("|");
}

export const workspaceDirectoryObserver = new DirectoryObserver();
