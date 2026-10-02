import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { DirectoryVersion } from "@getpaseo/protocol/messages";
import { DirectoryObserver, type DirectoryObserverDependencies } from "./directory-observer.js";

interface ControlledWatch {
  directory: string;
  onChange: (filename: string | null) => void;
  onError: () => void;
  closed: boolean;
}

class DirectoryControls implements DirectoryObserverDependencies {
  watches: ControlledWatch[] = [];
  closes = 0;
  failNextWatch = false;
  private timeouts: Array<() => void | Promise<void>> = [];
  private intervals: Array<() => void | Promise<void>> = [];

  watchDirectory(
    directory: string,
    onChange: (filename: string | null) => void,
    onError: () => void,
  ) {
    if (this.failNextWatch) {
      this.failNextWatch = false;
      throw new Error("watch failed");
    }
    const watch: ControlledWatch = { directory, onChange, onError, closed: false };
    this.watches.push(watch);
    return {
      close: () => {
        watch.closed = true;
        this.closes += 1;
      },
    };
  }

  setTimeout(callback: () => void | Promise<void>): ReturnType<typeof setTimeout> {
    this.timeouts.push(callback);
    return this.timeouts.length as ReturnType<typeof setTimeout>;
  }

  clearTimeout(): void {
    this.timeouts.pop();
  }

  setInterval(callback: () => void | Promise<void>): ReturnType<typeof setInterval> {
    this.intervals.push(callback);
    return this.intervals.length as ReturnType<typeof setInterval>;
  }

  clearInterval(): void {
    this.intervals.pop();
  }

  async fire(directory: string, filename: string | null): Promise<void> {
    for (const watch of this.watches) {
      if (watch.directory === directory && !watch.closed) {
        watch.onChange(filename);
      }
    }
    const pending = this.timeouts.splice(0);
    for (const callback of pending) {
      await callback();
    }
  }

  async poll(): Promise<void> {
    const pending = this.intervals.slice();
    for (const callback of pending) {
      await callback();
    }
  }

  watchFor(directory: string): ControlledWatch | undefined {
    return this.watches.find((watch) => watch.directory === directory && !watch.closed);
  }
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "paseo-directory-observer-")));
  roots.push(root);
  await mkdir(path.join(root, "sub"));
  await writeFile(path.join(root, "sub", "a.txt"), "one", "utf8");
  return root;
}

describe("DirectoryObserver", () => {
  test("pushes a fresh listing when membership changes", async () => {
    const root = await workspace();
    const controls = new DirectoryControls();
    const observer = new DirectoryObserver(controls);
    const updates: DirectoryVersion[] = [];
    const subscription = await observer.subscribe({ cwd: root, path: "sub" }, (version) =>
      updates.push(version),
    );

    expect(subscription.initial.status).toBe("ready");
    await writeFile(path.join(root, "sub", "b.txt"), "two", "utf8");
    await controls.fire(path.join(root, "sub"), "b.txt");

    expect(updates).toHaveLength(1);
    const update = updates[0];
    expect(update.status).toBe("ready");
    if (update.status === "ready") {
      expect(update.directory.entries.map((entry) => entry.name).sort()).toEqual([
        "a.txt",
        "b.txt",
      ]);
    }
    subscription.unsubscribe();
  });

  test("does not republish an unchanged listing", async () => {
    const root = await workspace();
    const controls = new DirectoryControls();
    const observer = new DirectoryObserver(controls);
    const updates: DirectoryVersion[] = [];
    const subscription = await observer.subscribe({ cwd: root, path: "sub" }, (version) =>
      updates.push(version),
    );

    await controls.fire(path.join(root, "sub"), "a.txt");

    expect(updates).toHaveLength(0);
    subscription.unsubscribe();
  });

  test("reports missing when the directory itself is deleted", async () => {
    const root = await workspace();
    const controls = new DirectoryControls();
    const observer = new DirectoryObserver(controls);
    const updates: DirectoryVersion[] = [];
    const subscription = await observer.subscribe({ cwd: root, path: "sub" }, (version) =>
      updates.push(version),
    );

    await rm(path.join(root, "sub"), { recursive: true });
    // Deleting the directory produces no event on its own watch; the parent
    // watch reports it by basename.
    await controls.fire(path.join(root), "sub");

    expect(updates.map((version) => version.status)).toEqual(["missing"]);
    subscription.unsubscribe();
  });

  test("observes a directory created after subscribing to it missing", async () => {
    const root = await workspace();
    const controls = new DirectoryControls();
    const observer = new DirectoryObserver(controls);
    const updates: DirectoryVersion[] = [];
    const subscription = await observer.subscribe({ cwd: root, path: "newdir" }, (version) =>
      updates.push(version),
    );

    expect(subscription.initial.status).toBe("missing");
    await mkdir(path.join(root, "newdir"));
    await writeFile(path.join(root, "newdir", "made.txt"), "made", "utf8");
    await controls.fire(path.join(root), "newdir");

    expect(updates.map((version) => version.status)).toEqual(["ready"]);
    // Membership changes after recovery go through the directory's own watch.
    await writeFile(path.join(root, "newdir", "later.txt"), "later", "utf8");
    await controls.fire(path.join(root, "newdir"), "later.txt");
    expect(updates).toHaveLength(2);
    subscription.unsubscribe();
  });

  test("shares both watchers across subscribers and closes them on the last unsubscribe", async () => {
    const root = await workspace();
    const controls = new DirectoryControls();
    const observer = new DirectoryObserver(controls);

    const first = await observer.subscribe({ cwd: root, path: "sub" }, () => undefined);
    const second = await observer.subscribe({ cwd: root, path: "sub" }, () => undefined);

    // One watch on the directory, one on its parent.
    expect(controls.watches.filter((watch) => !watch.closed)).toHaveLength(2);
    first.unsubscribe();
    expect(controls.closes).toBe(0);
    second.unsubscribe();
    expect(controls.closes).toBe(2);
  });

  test("publishes shared watcher updates in each subscriber's path coordinates", async () => {
    const root = await workspace();
    const aliasParent = await mkdtemp(path.join(os.tmpdir(), "paseo-dir-observer-alias-"));
    roots.push(aliasParent);
    const aliasRoot = path.join(aliasParent, "workspace-link");
    await symlink(root, aliasRoot, "dir");
    const controls = new DirectoryControls();
    const observer = new DirectoryObserver(controls);
    const updates: Array<{ cwd: string; path: string }> = [];
    const direct = await observer.subscribe({ cwd: root, path: "sub" }, () => undefined);
    const alias = await observer.subscribe({ cwd: aliasRoot, path: "sub" }, (version) =>
      updates.push({ cwd: version.cwd, path: version.path }),
    );

    await writeFile(path.join(root, "sub", "b.txt"), "two", "utf8");
    await controls.fire(path.join(root, "sub"), "b.txt");

    expect(updates).toEqual([{ cwd: aliasRoot, path: "sub" }]);
    direct.unsubscribe();
    alias.unsubscribe();
  });

  test("falls back to polling when no watcher can be installed", async () => {
    const root = await workspace();
    const controls = new DirectoryControls();
    controls.failNextWatch = true; // directory watch
    controls.failNextWatch = true; // parent watch
    const observer = new DirectoryObserver(controls);
    const updates: DirectoryVersion[] = [];
    const subscription = await observer.subscribe({ cwd: root, path: "sub" }, (version) =>
      updates.push(version),
    );

    await writeFile(path.join(root, "sub", "b.txt"), "two", "utf8");
    await controls.poll();

    expect(updates.map((version) => version.status)).toEqual(["ready"]);
    subscription.unsubscribe();
  });
});
