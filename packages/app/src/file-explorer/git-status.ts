export type ExplorerGitStatus = "modified" | "added" | "untracked" | "conflicted";

export const GIT_STATUS_LETTER: Record<ExplorerGitStatus, string> = {
  modified: "M",
  added: "A",
  untracked: "U",
  conflicted: "C",
};
