import type { TerminalAppearanceSettings } from "@/hooks/use-settings";

// Ghostty config grammar: `key = value` per line, `#` starts a comment, keys may
// repeat (palette is one entry per ANSI slot). Unknown or unrenderable keys are
// reported as unsupported rather than dropped silently. The patch is sparse —
// only keys present in the file appear — so applying it never rewrites a field
// the config never mentioned.
export interface GhosttyImportResult {
  /** Sparse settings patch produced by the keys we can render. */
  settings: {
    terminalFontFamily?: string;
    terminalFontSize?: number;
    terminalScrollbackLines?: number;
    terminalAppearance?: Partial<TerminalAppearanceSettings>;
  };
  /** Raw config keys that produced settings values. */
  applied: string[];
  /** Raw config keys we cannot render. */
  unsupported: string[];
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function normalizeHexColor(value: string): string | undefined {
  const match = value.trim().match(HEX_COLOR);
  if (!match) return undefined;
  const digits = match[1];
  if (digits.length === 3) {
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`.toLowerCase();
  }
  // Drop alpha — xterm theme slots are opaque hex.
  return `#${digits.slice(0, 6)}`.toLowerCase();
}

const CURSOR_STYLES = new Set(["block", "underline", "bar"]);

type AppearanceColorKey = keyof Pick<
  TerminalAppearanceSettings,
  | "background"
  | "foreground"
  | "cursorColor"
  | "cursorText"
  | "selectionBackground"
  | "selectionForeground"
>;

interface ParseContext {
  settings: GhosttyImportResult["settings"];
  appearance: Partial<TerminalAppearanceSettings>;
  applied: Set<string>;
  unsupported: string[];
  palette: Map<number, string>;
}

function pushUnsupported(ctx: ParseContext, key: string): void {
  if (!ctx.unsupported.includes(key)) ctx.unsupported.push(key);
}

function applyColor(slot: AppearanceColorKey) {
  return (ctx: ParseContext, key: string, value: string) => {
    const color = normalizeHexColor(value);
    if (color === undefined) {
      pushUnsupported(ctx, key);
      return;
    }
    ctx.appearance[slot] = color;
    ctx.applied.add(key);
  };
}

function applyPositiveInt(assign: (ctx: ParseContext, parsed: number) => void) {
  return (ctx: ParseContext, key: string, value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      assign(ctx, parsed);
      ctx.applied.add(key);
    } else {
      pushUnsupported(ctx, key);
    }
  };
}

function handleFontFamily(ctx: ParseContext, key: string, value: string): void {
  if (value.length === 0) return;
  ctx.settings.terminalFontFamily = value;
  ctx.applied.add(key);
}

function handleFontSize(ctx: ParseContext, key: string, value: string): void {
  const size = Number.parseFloat(value);
  if (Number.isFinite(size) && size > 0) {
    ctx.settings.terminalFontSize = Math.round(size);
    ctx.applied.add(key);
  } else {
    pushUnsupported(ctx, key);
  }
}

function handleCursorStyle(ctx: ParseContext, key: string, value: string): void {
  if (CURSOR_STYLES.has(value)) {
    ctx.appearance.cursorStyle = value as "block" | "underline" | "bar";
    ctx.applied.add(key);
  } else {
    pushUnsupported(ctx, key);
  }
}

function handleCursorBlink(ctx: ParseContext, key: string, value: string): void {
  if (value === "true" || value === "false") {
    ctx.appearance.cursorBlink = value === "true";
    ctx.applied.add(key);
  } else {
    pushUnsupported(ctx, key);
  }
}

function handlePalette(ctx: ParseContext, key: string, value: string): void {
  // palette = N=#hex — one ANSI slot per line.
  const paletteEq = value.indexOf("=");
  const index = paletteEq < 0 ? Number.NaN : Number.parseInt(value.slice(0, paletteEq), 10);
  const color = paletteEq < 0 ? undefined : normalizeHexColor(value.slice(paletteEq + 1));
  if (Number.isInteger(index) && index >= 0 && index <= 15 && color !== undefined) {
    ctx.palette.set(index, color);
    ctx.applied.add(key);
  } else {
    pushUnsupported(ctx, `palette ${Number.isInteger(index) ? index : value}`);
  }
}

const KEY_HANDLERS: Record<string, (ctx: ParseContext, key: string, value: string) => void> = {
  "font-family": handleFontFamily,
  "font-size": handleFontSize,
  background: applyColor("background"),
  foreground: applyColor("foreground"),
  "cursor-color": applyColor("cursorColor"),
  "cursor-text": applyColor("cursorText"),
  "selection-background": applyColor("selectionBackground"),
  "selection-foreground": applyColor("selectionForeground"),
  "cursor-style": handleCursorStyle,
  "cursor-style-blink": handleCursorBlink,
  "scrollback-limit": applyPositiveInt((ctx, lines) => {
    ctx.settings.terminalScrollbackLines = lines;
  }),
  palette: handlePalette,
};

function parseLine(ctx: ParseContext, line: string): void {
  const eq = line.indexOf("=");
  if (eq < 0) {
    pushUnsupported(ctx, line);
    return;
  }
  const key = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();
  if (key.length === 0) return;
  const handler = KEY_HANDLERS[key];
  if (handler === undefined) {
    pushUnsupported(ctx, key);
    return;
  }
  handler(ctx, key, value);
}

export function parseGhosttyConfig(text: string): GhosttyImportResult {
  const ctx: ParseContext = {
    settings: {},
    appearance: {},
    applied: new Set(),
    unsupported: [],
    palette: new Map(),
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    parseLine(ctx, line);
  }

  if (ctx.palette.size > 0) {
    ctx.appearance.palette = Array.from({ length: 16 }, (_, index) => ctx.palette.get(index) ?? "");
  }
  if (Object.keys(ctx.appearance).length > 0) {
    ctx.settings.terminalAppearance = ctx.appearance;
  }

  return {
    settings: ctx.settings,
    applied: [...ctx.applied],
    unsupported: ctx.unsupported,
  };
}
