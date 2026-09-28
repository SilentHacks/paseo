import { promises as fs } from "node:fs";
import path from "node:path";
import { expandUserPath } from "../path-utils.js";
import { runGitCommand } from "../../utils/run-git-command.js";

export type ExplorerGitStatus = "modified" | "added" | "untracked" | "conflicted";

// One porcelain scan is cheap (output scales with changed files, not repo size)
// and every directory listing refreshes it, so a short TTL keeps badges current
// without watching .git.
const STATUS_CACHE_TTL_MS = 4_000;
const STATUS_TIMEOUT_MS = 5_000;

interface CachedStatus {
  fetchedAt: number;
  // null = workspace is not inside a git work tree (or git is unavailable).
  statuses: Map<string, ExplorerGitStatus> | null;
}

const statusCache = new Map<string, CachedStatus>();

export function invalidateExplorerGitStatus(root: string): void {
  statusCache.delete(expandUserPath(root));
}

/**
 * Worktree statuses for every changed path under the workspace root, keyed by
 * workspace-relative path (directories from collapsed `??` records keep their
 * trailing slash). Null when the root is not inside a git work tree or git is
 * unavailable — callers treat null as "no badges".
 */
export async function gitStatusForRoot(
  root: string,
): Promise<Map<string, ExplorerGitStatus> | null> {
  const expandedRoot = expandUserPath(root);
  const cached = statusCache.get(expandedRoot);
  if (cached && Date.now() - cached.fetchedAt < STATUS_CACHE_TTL_MS) {
    return cached.statuses;
  }
  const realRoot = await fs.realpath(expandedRoot);
  const statuses = await fetchStatuses(realRoot);
  statusCache.set(expandedRoot, { fetchedAt: Date.now(), statuses });
  return statuses;
}

async function fetchStatuses(realRoot: string): Promise<Map<string, ExplorerGitStatus> | null> {
  const toplevel = await runGitCommand(["rev-parse", "--show-toplevel"], {
    cwd: realRoot,
    acceptExitCodes: [0, 128],
    timeout: STATUS_TIMEOUT_MS,
  });
  if (toplevel.exitCode !== 0) {
    return null;
  }
  const repoRoot = toplevel.stdout.trim();
  const status = await runGitCommand(
    ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    { cwd: repoRoot, acceptExitCodes: [0, 128], timeout: STATUS_TIMEOUT_MS },
  );
  if (status.exitCode !== 0) {
    return null;
  }
  // Porcelain paths are repo-root-relative; keep only the ones under the
  // workspace root and re-key them workspace-relative.
  const repoRelative = path.relative(repoRoot, realRoot);
  const workspacePrefix = repoRelative === "" ? "" : `${repoRelative.split(path.sep).join("/")}/`;
  return parsePorcelain(status.stdout, workspacePrefix);
}

function parsePorcelain(output: string, workspacePrefix: string): Map<string, ExplorerGitStatus> {
  const statuses = new Map<string, ExplorerGitStatus>();
  // -z records: "XY path\0"; renames/copies append the source path as a bare
  // second record.
  const records = output.split("\0");
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) {
      continue;
    }
    const x = record[0];
    const y = record[1];
    const entryPath = record.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      index += 1;
    }
    if (workspacePrefix !== "" && !entryPath.startsWith(workspacePrefix)) {
      continue;
    }
    const relativePath = entryPath.slice(workspacePrefix.length);
    if (relativePath === "") {
      continue;
    }
    statuses.set(relativePath, statusFromCode(x, y));
  }
  return statuses;
}

function statusFromCode(x: string, y: string): ExplorerGitStatus {
  if (x === "?" || y === "?") {
    return "untracked";
  }
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    return "conflicted";
  }
  if (x === "A") {
    return "added";
  }
  return "modified";
}

const STATUS_PRECEDENCE: Record<ExplorerGitStatus, number> = {
  conflicted: 0,
  modified: 1,
  added: 2,
  untracked: 3,
};

/**
 * A directory's badge aggregates its descendants so a collapsed folder still
 * shows that work happened inside it. Untracked parents propagate untracked —
 * a file inside a `??` directory is itself untracked.
 */
export function statusForExplorerEntry(
  relativePath: string,
  kind: "file" | "directory",
  statuses: Map<string, ExplorerGitStatus>,
): ExplorerGitStatus | undefined {
  const direct = statuses.get(relativePath) ?? statuses.get(`${relativePath}/`);
  if (kind === "file") {
    return direct ?? untrackedAncestorStatus(relativePath, statuses);
  }
  if (direct === "untracked") {
    return "untracked";
  }
  const fromParent = untrackedAncestorStatus(relativePath, statuses);
  if (fromParent) {
    return fromParent;
  }
  let best: ExplorerGitStatus | undefined = direct;
  const prefix = `${relativePath}/`;
  for (const [changedPath, status] of statuses) {
    if (!changedPath.startsWith(prefix)) {
      continue;
    }
    if (!best || STATUS_PRECEDENCE[status] < STATUS_PRECEDENCE[best]) {
      best = status;
    }
    if (best === "conflicted") {
      break;
    }
  }
  return best;
}

function untrackedAncestorStatus(
  relativePath: string,
  statuses: Map<string, ExplorerGitStatus>,
): ExplorerGitStatus | undefined {
  let ancestor = relativePath;
  while (ancestor.includes("/")) {
    ancestor = ancestor.slice(0, ancestor.lastIndexOf("/"));
    const status = statuses.get(ancestor) ?? statuses.get(`${ancestor}/`);
    if (status === "untracked") {
      return "untracked";
    }
  }
  return undefined;
}
