import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type TextStyle } from "react-native";
import { StyleSheet, UnistylesRuntime } from "react-native-unistyles";
import { useAppSettings } from "@/hooks/use-settings";
import { applyTerminalAppearance } from "@/terminal/apply-terminal-appearance";
import { DEFAULT_TERMINAL_FONT_FAMILY } from "@/terminal/runtime/terminal-font";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { toXtermTheme } from "@/utils/to-xterm-theme";

export interface TerminalPreviewOverrides {
  // Live draft values for the terminal font applied while typing; empty/invalid
  // fields fall back to the committed setting (which itself falls back to the
  // code font when unset).
  fontFamily?: string;
  fontSize?: number;
}

interface TerminalAppearancePreviewProps {
  overrides?: TerminalPreviewOverrides;
}

// Self-contained terminal mock: prompt line, directory listing, error line, and
// a cursor block. Colors come from the active theme's ANSI palette merged with
// the committed terminalAppearance overrides — the same composition the real
// terminal renders.
export function TerminalAppearancePreview({ overrides }: TerminalAppearancePreviewProps) {
  const { t } = useTranslation();
  const { settings } = useAppSettings();
  const theme = UnistylesRuntime.getTheme();
  const termTheme = useMemo(
    () => applyTerminalAppearance(toXtermTheme(theme.colors.terminal), settings.terminalAppearance),
    [theme, settings.terminalAppearance],
  );

  const committedFamily = settings.terminalFontFamily.trim() || settings.monoFontFamily.trim();
  const draftFamily = overrides?.fontFamily?.trim();
  const fontFamily = draftFamily || committedFamily || DEFAULT_TERMINAL_FONT_FAMILY;
  const draftSize =
    typeof overrides?.fontSize === "number" && Number.isFinite(overrides.fontSize)
      ? overrides.fontSize
      : undefined;
  const fontSize =
    draftSize ??
    (settings.terminalFontSize > 0 ? settings.terminalFontSize : settings.codeFontSize);

  const textStyle = useMemo(
    () =>
      inlineUnistylesStyle({
        fontFamily,
        fontSize,
        lineHeight: Math.round(fontSize * 1.4),
      } satisfies TextStyle),
    [fontFamily, fontSize],
  );
  const cardStyle = useMemo(
    () => inlineUnistylesStyle({ backgroundColor: termTheme.background ?? "#000000" }),
    [termTheme.background],
  );
  const fgStyle = useMemo(
    () => inlineUnistylesStyle({ color: termTheme.foreground ?? "#ffffff" }),
    [termTheme.foreground],
  );
  const colorStyle = (color: string | undefined, fallback: string) =>
    inlineUnistylesStyle({ color: color ?? fallback });
  const cursorStyle = useMemo(
    () =>
      inlineUnistylesStyle({
        backgroundColor: termTheme.cursor ?? "#ffffff",
        color: termTheme.cursorAccent ?? termTheme.background ?? "#000000",
      }),
    [termTheme.cursor, termTheme.cursorAccent, termTheme.background],
  );
  const selectionStyle = useMemo(
    () =>
      inlineUnistylesStyle({
        backgroundColor: termTheme.selectionBackground ?? "#333333",
        color: termTheme.selectionForeground ?? termTheme.foreground ?? "#ffffff",
      }),
    [termTheme.selectionBackground, termTheme.selectionForeground, termTheme.foreground],
  );

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={t("settings.appearance.terminal.previewAccessibility")}
      style={[styles.card, cardStyle]}
    >
      <Text style={[styles.line, textStyle, fgStyle]} numberOfLines={1}>
        <Text style={colorStyle(termTheme.green, "#00ff00")}>❯</Text>
        <Text style={colorStyle(termTheme.blue, "#0000ff")}> ~/paseo</Text>
        <Text> ls</Text>
      </Text>
      <Text style={[styles.line, textStyle, fgStyle]} numberOfLines={1}>
        <Text style={colorStyle(termTheme.blue, "#0000ff")}>src/ packages/</Text>
        <Text> package.json </Text>
        <Text style={selectionStyle}>README.md</Text>
      </Text>
      <Text style={[styles.line, textStyle, fgStyle]} numberOfLines={1}>
        <Text style={colorStyle(termTheme.yellow, "#ffff00")}>warning:</Text>
        <Text> deprecated flag, </Text>
        <Text style={colorStyle(termTheme.red, "#ff0000")}>error:</Text>
        <Text> command not found</Text>
      </Text>
      <Text style={[styles.line, textStyle, fgStyle]} numberOfLines={1}>
        <Text style={colorStyle(termTheme.green, "#00ff00")}>❯</Text>
        <Text> </Text>
        <Text style={cursorStyle}> </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    overflow: "hidden",
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
  line: {
    fontFamily: theme.fontFamily.mono,
  },
}));
