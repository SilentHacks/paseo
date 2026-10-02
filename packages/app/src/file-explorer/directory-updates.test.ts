import { describe, expect, it } from "vitest";
import type { DirectoryVersion } from "@getpaseo/protocol/messages";
import type { ExplorerDirectory, ExplorerEntry } from "@/stores/session-store";
import { applyDirectoryVersionToDirectories } from "./directory-updates";

function entry(name: string, overrides?: Partial<ExplorerEntry>): ExplorerEntry {
  return {
    name,
    path: name,
    kind: "file",
    size: 1,
    modifiedAt: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

function readyVersion(path: string, entries: ExplorerEntry[]): DirectoryVersion {
  return {
    status: "ready",
    cwd: "/repo",
    path,
    directory: { path, entries },
  };
}

describe("applyDirectoryVersionToDirectories", () => {
  it("writes a pushed listing for a subscribed directory", () => {
    const directories = new Map<string, ExplorerDirectory>();
    const next = applyDirectoryVersionToDirectories(
      directories,
      readyVersion("src", [entry("a.ts", { path: "src/a.ts" })]),
    );
    expect(next?.get("src")?.entries.map((e) => e.name)).toEqual(["a.ts"]);
  });

  it("returns null when the pushed listing is identical to the cached one", () => {
    const directories = new Map<string, ExplorerDirectory>([
      [".", { path: ".", entries: [entry("a.ts")] }],
    ]);
    const next = applyDirectoryVersionToDirectories(
      directories,
      readyVersion(".", [entry("a.ts")]),
    );
    expect(next).toBeNull();
  });

  it("evicts a missing directory and its cached subtree listings", () => {
    const directories = new Map<string, ExplorerDirectory>([
      ["a", { path: "a", entries: [] }],
      ["a/b", { path: "a/b", entries: [] }],
      ["a/b/c", { path: "a/b/c", entries: [] }],
      ["other", { path: "other", entries: [] }],
    ]);
    const next = applyDirectoryVersionToDirectories(directories, {
      status: "missing",
      cwd: "/repo",
      path: "a/b",
    });
    expect(next && [...next.keys()].sort()).toEqual(["a", "other"]);
  });

  it("clears every cached listing when the workspace root disappears", () => {
    const directories = new Map<string, ExplorerDirectory>([
      [".", { path: ".", entries: [] }],
      ["src", { path: "src", entries: [] }],
    ]);
    const next = applyDirectoryVersionToDirectories(directories, {
      status: "missing",
      cwd: "/repo",
      path: ".",
    });
    expect(next?.size).toBe(0);
  });

  it("leaves the map untouched on error versions", () => {
    const directories = new Map<string, ExplorerDirectory>([[".", { path: ".", entries: [] }]]);
    const next = applyDirectoryVersionToDirectories(directories, {
      status: "error",
      cwd: "/repo",
      path: ".",
      error: "watch failed",
    });
    expect(next).toBeNull();
  });
});
