import { describe, expect, it } from "vitest";
import { isVideoMimeType, isVideoPreviewable, resolveVideoMimeType } from "./media-preview";

describe("media preview helpers", () => {
  it("recognizes video mimes by prefix", () => {
    expect(isVideoMimeType("video/mp4")).toBe(true);
    expect(isVideoMimeType("video/x-matroska")).toBe(true);
    expect(isVideoMimeType("application/pdf")).toBe(false);
    expect(isVideoMimeType("application/octet-stream")).toBe(false);
    expect(isVideoMimeType(undefined)).toBe(false);
    expect(isVideoMimeType(null)).toBe(false);
  });

  it("resolves the daemon's video mime when present", () => {
    expect(resolveVideoMimeType({ mimeType: "video/quicktime", path: "clip.bin" })).toBe(
      "video/quicktime",
    );
  });

  it("falls back to the extension for generic binary mimes", () => {
    expect(resolveVideoMimeType({ mimeType: "application/octet-stream", path: "clip.mp4" })).toBe(
      "video/mp4",
    );
    expect(resolveVideoMimeType({ mimeType: "application/octet-stream", path: "Clip.MOV" })).toBe(
      "video/quicktime",
    );
    expect(resolveVideoMimeType({ mimeType: "application/octet-stream", path: "clip.mkv" })).toBe(
      "video/x-matroska",
    );
    expect(resolveVideoMimeType({ mimeType: "application/octet-stream", path: "clip.avi" })).toBe(
      "video/x-msvideo",
    );
    expect(resolveVideoMimeType({ path: "clip.webm" })).toBe("video/webm");
  });

  it("trusts a real non-video mime over the extension", () => {
    expect(resolveVideoMimeType({ mimeType: "application/pdf", path: "clip.mp4" })).toBeUndefined();
    expect(isVideoPreviewable({ mimeType: "application/pdf", path: "clip.mp4" })).toBe(false);
  });

  it("rejects non-video extensions", () => {
    expect(isVideoPreviewable({ mimeType: "application/octet-stream", path: "archive.zip" })).toBe(
      false,
    );
    expect(isVideoPreviewable({ path: "README" })).toBe(false);
  });
});
