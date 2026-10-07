// src/decorationManager.ts
// Manages TextEditorDecorationType lifecycle — one type per color, reused across editors.

import * as vscode from "vscode";
import { Highlight } from "./types";
import { findRangeInDocument } from "./highlightMatcher";

// Cache of decoration types keyed by color, opacity, and background visibility.
const decorationTypeCache = new Map<string, vscode.TextEditorDecorationType>();

/**
 * Get or create a decoration type for a given hex color.
 * Decoration types are expensive — we reuse them.
 */
export function getOrCreateDecorationType(
  color: string,
  opacity: number,
  backgroundVisible: boolean
): vscode.TextEditorDecorationType {
  const cacheKey = `${color}:${opacity}:${backgroundVisible}`;
  const cached = decorationTypeCache.get(cacheKey);
  if (cached) { return cached; }

  const backgroundColor = backgroundVisible
    ? hexToRgba(color, opacity)
    : "transparent";
  const border = backgroundVisible
    ? `1px solid ${hexToRgba(color, opacity)}`
    : "none";

  const decorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor,
    border,
    borderRadius: "2px",
    overviewRulerColor: hexToRgba(color, 1),
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    // Subtle gutter indicator
    gutterIconPath: undefined,
    // Light theme gets a slightly darker tint
    light: {
      backgroundColor,
      border,
    },
    dark: {
      backgroundColor,
      border,
    },
  });

  decorationTypeCache.set(cacheKey, decorationType);
  return decorationType;
}

/**
 * Apply highlights for a given editor.
 * Groups highlights by color for efficient setDecorations calls.
 */
export function applyHighlightsToEditor(
  editor: vscode.TextEditor,
  highlights: Highlight[],
  fuzzyThreshold: number = 0.75
): void {
  // Clear all existing decorations first
  for (const [, decType] of decorationTypeCache) {
    editor.setDecorations(decType, []);
  }

  if (highlights.length === 0) { return; }

  // Group by color
  const byStyle = new Map<string, {
    color: string;
    opacity: number;
    backgroundVisible: boolean;
    decorations: vscode.DecorationOptions[];
  }>();
  const defaultOpacity = vscode.workspace
    .getConfiguration("codemark")
    .get<number>("highlightOpacity", 0.28);

  for (const h of highlights) {
    const range = findRangeInDocument(
      editor.document,
      h.codeSnippet,
      h.codeHash,
      fuzzyThreshold
    );
    if (!range) { continue; }

    const opacity = h.opacity ?? defaultOpacity;
    const backgroundVisible = h.backgroundVisible !== false;
    const styleKey = `${h.color}:${opacity}:${backgroundVisible}`;
    if (!byStyle.has(styleKey)) {
      byStyle.set(styleKey, {
        color: h.color,
        opacity,
        backgroundVisible,
        decorations: [],
      });
    }

    const hoverMsg = new vscode.MarkdownString(
      `**Code Mark** — \`${h.tag || "No tag"}\`\n\n` +
      `*${new Date(h.createdAt).toLocaleDateString()}*`
    );
    hoverMsg.isTrusted = true;

    byStyle.get(styleKey)!.decorations.push({
      range,
      hoverMessage: hoverMsg,
    });
  }

  // Apply decorations per color group
  for (const style of byStyle.values()) {
    const decType = getOrCreateDecorationType(
      style.color,
      style.opacity,
      style.backgroundVisible
    );
    editor.setDecorations(decType, style.decorations);
  }
}

/**
 * Clear all Code Mark decorations from an editor.
 */
export function clearAllDecorations(editor: vscode.TextEditor): void {
  for (const [, decType] of decorationTypeCache) {
    editor.setDecorations(decType, []);
  }
}

/**
 * Dispose all decoration types. Call on extension deactivate.
 */
export function disposeAllDecorations(): void {
  for (const [, decType] of decorationTypeCache) {
    decType.dispose();
  }
  decorationTypeCache.clear();
}

/**
 * Find which highlight the cursor is currently inside (if any).
 * Returns the highlight ID or undefined.
 */
export function findHighlightAtCursor(
  editor: vscode.TextEditor,
  highlights: Highlight[],
  fuzzyThreshold: number = 0.75
): Highlight | undefined {
  const cursorPos = editor.selection.active;

  for (const h of highlights) {
    const range = findRangeInDocument(
      editor.document,
      h.codeSnippet,
      h.codeHash,
      fuzzyThreshold
    );
    if (range && range.contains(cursorPos)) {
      return h;
    }
  }
  return undefined;
}

// --- Utility ---

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  const colorAlpha = clean.length === 8
    ? parseInt(clean.substring(6, 8), 16) / 255
    : 1;
  return `rgba(${r}, ${g}, ${b}, ${alpha * colorAlpha})`;
}
