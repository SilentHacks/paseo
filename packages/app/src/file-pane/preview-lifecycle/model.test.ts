import type { FileReadResult } from "@getpaseo/client/internal/daemon-client";
import type { AttachmentMetadata, AttachmentStore, SaveAttachmentInput } from "@/attachments/types";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import type { LiveFileSnapshot } from "../live-file/model";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFilePanePreview,
  FilePreviewLifecycleModel,
  type FilePanePreview,
  type FilePreviewLifecycleSnapshot,
} from "./model";

function previewFile(content: string) {
  return {
    kind: "text" as const,
    path: "file.ts",
    size: 7,
    encoding: "utf-8" as const,
    hasBom: false,
    modifiedAt: "2026-08-20T00:00:00.000Z",
    content,
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function file(revision = "revision-1", path = "file.ts"): FileReadResult {
  return {
    bytes: new TextEncoder().encode("preview"),
    mime: "text/plain",
    size: 7,
    path,
    kind: "text",
    modifiedAt: "2026-08-20T00:00:00.000Z",
    revision,
  };
}

function pending(): LiveFileSnapshot {
  return { observation: null, read: { status: "pending", requested: false } };
}

function completed(rawFile: FileReadResult): LiveFileSnapshot {
  return {
    observation: {
      status: "ready",
      file: rawFile,
      version: {
        status: "ready",
        cwd: "/workspace",
        path: rawFile.path,
        size: rawFile.size,
        modifiedAt: rawFile.modifiedAt,
        revision: rawFile.revision,
      },
    },
    read: { status: "idle" },
  };
}

function source(
  targetKey: string,
  snapshot: LiveFileSnapshot,
): {
  targetKey: string;
  liveFileSnapshot: LiveFileSnapshot;
} {
  return { targetKey, liveFileSnapshot: snapshot };
}

describe("FilePreviewLifecycleModel", () => {
  it("represents pending raw reads, preparation, ready previews, unsupported files, and conversion failures", async () => {
    const first = deferred<FilePanePreview | null>();
    const second = deferred<FilePanePreview | null>();
    const third = deferred<FilePanePreview | null>();
    const preparations = [first, second, third];
    const model = new FilePreviewLifecycleModel(() => preparations.shift()!.promise);
    const preview: FilePanePreview = {
      file: previewFile("preview"),
      mediaAttachment: null,
    };

    model.setSource(source("/workspace:file.ts", pending()));
    expect(model.getSnapshot()).toEqual({ status: "read_pending" });

    model.setSource(source("/workspace:file.ts", completed(file("one"))));
    expect(model.getSnapshot()).toEqual({ status: "preparing" });
    first.resolve(preview);
    await expectSnapshot(model, { status: "ready", preview });

    model.setSource(source("/workspace:file.ts", pending()));
    expect(model.getSnapshot()).toEqual({ status: "read_pending", preview });

    model.setSource(
      source("/workspace:file.ts", {
        observation: {
          status: "error",
          cwd: "/workspace",
          path: "file.ts",
          error: "Requested path is not a file",
        },
        read: { status: "pending", requested: true },
      }),
    );
    expect(model.getSnapshot()).toEqual({ status: "read_pending", preview });

    model.setSource(source("/workspace:file.ts", completed(file("two"))));
    expect(model.getSnapshot()).toEqual({ status: "preparing", preview });
    second.resolve(null);
    await expectSnapshot(model, { status: "unsupported" });

    model.setSource(source("/workspace:file.ts", completed(file("three"))));
    expect(model.getSnapshot()).toEqual({ status: "preparing" });
    third.reject(new Error("attachment failed"));
    await expectSnapshot(model, { status: "error", message: "attachment failed" });
  });

  it("does not publish a stale conversion after retargeting", async () => {
    const first = deferred<FilePanePreview | null>();
    const second = deferred<FilePanePreview | null>();
    const model = new FilePreviewLifecycleModel((rawFile) =>
      rawFile.revision === "one" ? first.promise : second.promise,
    );
    const nextPreview: FilePanePreview = {
      file: previewFile("two"),
      mediaAttachment: null,
    };

    model.setSource(source("/workspace:file.ts", completed(file("one"))));
    model.setSource(source("/workspace:second.ts", completed(file("two", "second.ts"))));
    first.resolve({ file: previewFile("one"), mediaAttachment: null });
    await Promise.resolve();
    expect(model.getSnapshot()).toEqual({ status: "preparing" });

    second.resolve(nextPreview);
    await expectSnapshot(model, { status: "ready", preview: nextPreview });
  });
});

describe("createFilePanePreview", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
  });

  it("persists a media attachment for a video mime", async () => {
    const store = stubAttachmentStore();
    __setAttachmentStoreForTests(store);

    const preview = await createFilePanePreview(binaryFile("clip.mp4", "video/mp4"));

    expect(preview?.file.kind).toBe("binary");
    expect(preview?.mediaAttachment?.mimeType).toBe("video/mp4");
    expect(store.saved).toHaveLength(1);
  });

  it("resolves a video mime from the extension for octet-stream reads", async () => {
    const store = stubAttachmentStore();
    __setAttachmentStoreForTests(store);

    const preview = await createFilePanePreview(binaryFile("clip.mov", "application/octet-stream"));

    expect(preview?.mediaAttachment?.mimeType).toBe("video/quicktime");
    expect(store.saved).toHaveLength(1);
  });

  it("leaves non-media binaries without an attachment", async () => {
    const store = stubAttachmentStore();
    __setAttachmentStoreForTests(store);

    const preview = await createFilePanePreview(
      binaryFile("archive.zip", "application/octet-stream"),
    );

    expect(preview?.mediaAttachment).toBeNull();
    expect(store.saved).toHaveLength(0);
  });
});

function binaryFile(path: string, mime: string): FileReadResult {
  return {
    bytes: new Uint8Array([0x00, 0x01]),
    mime,
    size: 2,
    path,
    kind: "binary",
    modifiedAt: "2026-08-20T00:00:00.000Z",
    revision: "revision-1",
  };
}

function stubAttachmentStore(): AttachmentStore & { saved: SaveAttachmentInput[] } {
  const saved: SaveAttachmentInput[] = [];
  return {
    storageType: "web-indexeddb",
    saved,
    async save(input): Promise<AttachmentMetadata> {
      saved.push(input);
      return {
        id: input.id ?? `att-${saved.length}`,
        mimeType: input.mimeType ?? "application/octet-stream",
        storageType: "web-indexeddb",
        storageKey: `key-${saved.length}`,
        fileName: input.fileName ?? null,
        byteSize: 0,
        createdAt: 0,
      };
    },
    async encodeBase64() {
      return "";
    },
    async resolvePreviewUrl() {
      return "blob:preview";
    },
    async delete() {},
    async garbageCollect() {},
  };
}

async function expectSnapshot(
  model: FilePreviewLifecycleModel,
  expected: FilePreviewLifecycleSnapshot,
): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(model.getSnapshot()).toEqual(expected);
}
