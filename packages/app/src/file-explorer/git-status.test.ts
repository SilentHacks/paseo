import { describe, expect, it } from "vitest";
import type { ExplorerEntry } from "@/stores/session-store";
import { GIT_STATUS_LETTER, type ExplorerGitStatus } from "./git-status";
import { flattenExplorerTree } from "./tree";

const ALL_STATUSES: ExplorerGitStatus[] = ["modified", "added", "untracked", "conflicted"];

describe("explorer git status", () => {
  it("has a single-letter badge for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(GIT_STATUS_LETTER[status]).toMatch(/^[A-Z]$/);
    }
    expect(Object.keys(GIT_STATUS_LETTER).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("keeps gitStatus on entries that flow into tree rows", () => {
    const entry: ExplorerEntry = {
      name: "app.ts",
      path: "app.ts",
      kind: "file",
      size: 10,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      gitStatus: "modified",
    };
    const directories = new Map([[".", { path: ".", entries: [entry] }]]);
    const rows = flattenExplorerTree({
      directories,
      expandedPaths: new Set(["."]),
      sortOption: "name",
      showHiddenFiles: true,
    });
    expect(rows[0]?.entry.gitStatus).toBe("modified");
  });
});
