import type { ITheme } from "@xterm/xterm";
import type { TerminalAppearanceSettings } from "@/hooks/use-settings";

// ANSI palette slot order matches xterm's ITheme keys — palette[N] in a
// Ghostty-style config maps onto these in order.
const ANSI_THEME_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

export function applyTerminalAppearance(
  theme: ITheme,
  appearance: TerminalAppearanceSettings,
): ITheme {
  const merged: ITheme = { ...theme };
  if (appearance.background) merged.background = appearance.background;
  if (appearance.foreground) merged.foreground = appearance.foreground;
  if (appearance.cursorColor) merged.cursor = appearance.cursorColor;
  if (appearance.cursorText) merged.cursorAccent = appearance.cursorText;
  if (appearance.selectionBackground) merged.selectionBackground = appearance.selectionBackground;
  if (appearance.selectionForeground) merged.selectionForeground = appearance.selectionForeground;
  appearance.palette.forEach((color, index) => {
    const key = ANSI_THEME_KEYS[index];
    if (key !== undefined && color) {
      merged[key] = color;
    }
  });
  return merged;
}

// Sparse-merge an imported patch into committed settings. Palette arrays merge
// per-index: an empty slot in the patch keeps the committed color at that index.
export function mergeTerminalAppearance(
  current: TerminalAppearanceSettings,
  patch: Partial<TerminalAppearanceSettings>,
): TerminalAppearanceSettings {
  const merged: TerminalAppearanceSettings = { ...current, ...patch };
  if (patch.palette !== undefined) {
    merged.palette = Array.from({ length: 16 }, (_, index) => {
      const incoming = patch.palette?.[index];
      return incoming && incoming !== "" ? incoming : (current.palette[index] ?? "");
    });
  }
  return merged;
}

export function hasTerminalAppearanceOverrides(appearance: TerminalAppearanceSettings): boolean {
  return (
    appearance.background !== "" ||
    appearance.foreground !== "" ||
    appearance.cursorColor !== "" ||
    appearance.cursorText !== "" ||
    appearance.selectionBackground !== "" ||
    appearance.selectionForeground !== "" ||
    appearance.cursorStyle !== "" ||
    appearance.cursorBlink !== null ||
    appearance.palette.some((color) => color !== "")
  );
}
