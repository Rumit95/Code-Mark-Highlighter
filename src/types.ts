// src/types.ts
// Shared type definitions for Code Mark Highlighter extension

export interface Highlight {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Workspace-relative file path */
  filePath: string;
  /** The exact selected text that was highlighted */
  codeSnippet: string;
  /** SHA-256 hash of codeSnippet for fast exact matching */
  codeHash: string;
  /** User-assigned tag e.g. "TODO", "Bug", "Important" */
  tag: string;
  /** Hex color string e.g. "#FFD700" */
  color: string;
  /** Per-highlight background opacity from 0 (transparent) to 1 (opaque). */
  opacity?: number;
  /** Whether this highlight's editor background is visible. Defaults to true. */
  backgroundVisible?: boolean;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

export interface HighlightStore {
  version: number;
  highlights: Highlight[];
}

export interface ColorOption {
  label: string;
  emoji: string;
  hex: string;
}

export const PRESET_COLORS: ColorOption[] = [
  { label: "Golden Yellow",  emoji: "🟡", hex: "#FFD700" },
  { label: "Lime Green",     emoji: "🟢", hex: "#50FA7B" },
  { label: "Hot Pink",       emoji: "🩷", hex: "#FF6EB4" },
  { label: "Sky Blue",       emoji: "🔵", hex: "#87CEEB" },
  { label: "Coral Red",      emoji: "🔴", hex: "#FF6B6B" },
  { label: "Lavender",       emoji: "🟣", hex: "#C9B8E8" },
  { label: "Orange",         emoji: "🟠", hex: "#FF9F43" },
  { label: "Cyan",           emoji: "🩵", hex: "#62D6E8" },
];

export const DEFAULT_TAGS = [
  "TODO",
  "Important",
  "Refactor",
  "Bug",
  "Logic",
  "Interview",
  "Optimization",
  "Review",
  "Question",
  "Note",
];
