// Video extensions the file pane can offer a media preview for. The daemon
// labels video/* mimes, but released daemons still send octet-stream for
// binaries — the extension fallback keeps previews working against them.
const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

const GENERIC_BINARY_MIMES = new Set(["application/octet-stream", "binary/octet-stream"]);

export function isVideoMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("video/");
}

export function isVideoPreviewable(input: { mimeType?: string | null; path: string }): boolean {
  return resolveVideoMimeType(input) !== undefined;
}

/** The video mime for a previewable file: the daemon's when it's a real video/*, else the extension's. */
export function resolveVideoMimeType(input: {
  mimeType?: string | null;
  path: string;
}): string | undefined {
  const { mimeType, path } = input;
  if (typeof mimeType === "string" && isVideoMimeType(mimeType)) {
    return mimeType;
  }
  if (mimeType && !GENERIC_BINARY_MIMES.has(mimeType)) {
    return undefined;
  }
  const dot = path.lastIndexOf(".");
  if (dot < 0) {
    return undefined;
  }
  return VIDEO_MIME_BY_EXTENSION[path.slice(dot).toLowerCase()];
}
