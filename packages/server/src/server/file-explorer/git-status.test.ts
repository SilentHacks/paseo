import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGitCommand } from "../../utils/run-git-command.js";
import { gitStatusForRoot, statusForExplorerEntry, type ExplorerGitStatus } from "./git-status.js";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runGitCommand(args, { cwd, timeout: 10_000 });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr}`);
  }
}

async function commitAll(repo: string, message: string): Promise<void> {
  await git(repo, ["add", "-A"]);
  await git(repo, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=test",
    "commit",
    "-m",
    message,
  ]);
}

async function initRepo(): Promise<string> {
  const repo = await createTempDir("paseo-git-status-");
  await git(repo, ["init", "-b", "main"]);
  return repo;
}

describe("gitStatusForRoot", () => {
  it("returns null for a directory that is not a git work tree", async () => {
    const root = await createTempDir("paseo-nonrepo-");
    try {
      expect(await gitStatusForRoot(root)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports modified, added, and untracked paths relative to the workspace", async () => {
    const root = await initRepo();
    try {
      await writeFile(path.join(root, "tracked.txt"), "a", "utf8");
      await commitAll(root, "init");
      await writeFile(path.join(root, "tracked.txt"), "b", "utf8");
      await writeFile(path.join(root, "staged.txt"), "s", "utf8");
      await git(root, ["add", "staged.txt"]);
      await writeFile(path.join(root, "loose.txt"), "u", "utf8");
      await mkdir(path.join(root, "newdir"), { recursive: true });
      await writeFile(path.join(root, "newdir", "inner.txt"), "u", "utf8");

      const statuses = await gitStatusForRoot(root);
      expect(statuses).not.toBeNull();
      expect(statuses?.get("tracked.txt")).toBe("modified");
      expect(statuses?.get("staged.txt")).toBe("added");
      expect(statuses?.get("loose.txt")).toBe("untracked");
      expect(statuses?.get("newdir/")).toBe("untracked");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scopes statuses to a workspace nested inside a larger repo", async () => {
    const repo = await initRepo();
    try {
      await writeFile(path.join(repo, "outside.txt"), "a", "utf8");
      await mkdir(path.join(repo, "ws"), { recursive: true });
      await writeFile(path.join(repo, "ws", "inside.txt"), "a", "utf8");
      await commitAll(repo, "init");
      await writeFile(path.join(repo, "outside.txt"), "b", "utf8");
      await writeFile(path.join(repo, "ws", "inside.txt"), "b", "utf8");

      const statuses = await gitStatusForRoot(path.join(repo, "ws"));
      expect(statuses).not.toBeNull();
      expect(statuses?.get("inside.txt")).toBe("modified");
      expect(statuses?.get("outside.txt")).toBeUndefined();
      expect(statuses?.has("ws/inside.txt")).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe("statusForExplorerEntry", () => {
  function statuses(entries: Record<string, ExplorerGitStatus>): Map<string, ExplorerGitStatus> {
    return new Map(Object.entries(entries));
  }

  it("returns the file's own status", () => {
    const map = statuses({ "src/app.ts": "modified" });
    expect(statusForExplorerEntry("src/app.ts", "file", map)).toBe("modified");
    expect(statusForExplorerEntry("src/other.ts", "file", map)).toBeUndefined();
  });

  it("propagates untracked from a collapsed ?? directory record", () => {
    const map = statuses({ "newdir/": "untracked" });
    expect(statusForExplorerEntry("newdir/inner.txt", "file", map)).toBe("untracked");
    expect(statusForExplorerEntry("newdir", "directory", map)).toBe("untracked");
    expect(statusForExplorerEntry("newdir/deep/nested.txt", "file", map)).toBe("untracked");
  });

  it("aggregates a directory's descendants by precedence conflicted > modified > added > untracked", () => {
    const map = statuses({
      "pkg/alpha.ts": "added",
      "pkg/beta.ts": "untracked",
      "pkg/deep/merge.ts": "conflicted",
      "pkg/deep/other.ts": "modified",
    });
    expect(statusForExplorerEntry("pkg", "directory", map)).toBe("conflicted");
    expect(statusForExplorerEntry("pkg/deep", "directory", map)).toBe("conflicted");
    expect(statusForExplorerEntry("pkg/alpha.ts", "file", map)).toBe("added");
  });

  it("returns modified for a directory holding only modified files", () => {
    const map = statuses({ "pkg/a.ts": "modified" });
    expect(statusForExplorerEntry("pkg", "directory", map)).toBe("modified");
  });
});
