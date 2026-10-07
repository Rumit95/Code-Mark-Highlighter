// src/storage.ts
// Handles reading/writing highlights to .vscode/codemark.json and workspaceState

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Highlight, HighlightStore } from "./types";

const STORE_VERSION = 1;
const WS_STATE_KEY = "codemark.highlights";

function getStorageFilePath(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return null; }
  const cfg = vscode.workspace.getConfiguration("codemark");
  const rel = cfg.get<string>("storageFile", ".vscode/codemark.json");
  return path.join(folders[0].uri.fsPath, rel);
}

export function loadHighlights(context: vscode.ExtensionContext): Highlight[] {
  // Primary: try JSON file
  const filePath = getStorageFilePath();
  if (filePath && fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const store: HighlightStore = JSON.parse(raw);
      if (Array.isArray(store.highlights)) {
        // Mirror to workspaceState for fast access
        context.workspaceState.update(WS_STATE_KEY, store.highlights);
        return store.highlights;
      }
    } catch {
      // Fall through to workspace state
    }
  }
  // Fallback: workspaceState
  return context.workspaceState.get<Highlight[]>(WS_STATE_KEY) ?? [];
}

export function saveHighlights(
  context: vscode.ExtensionContext,
  highlights: Highlight[]
): void {
  // Update in-memory state immediately
  context.workspaceState.update(WS_STATE_KEY, highlights);

  // Write JSON file
  const filePath = getStorageFilePath();
  if (!filePath) { return; }

  // Ensure .vscode directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const store: HighlightStore = { version: STORE_VERSION, highlights };
  try {
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    vscode.window.showErrorMessage(`Code Mark: Failed to save highlights — ${err}`);
  }
}

export function getHighlightsForFile(
  context: vscode.ExtensionContext,
  filePath: string
): Highlight[] {
  const all = loadHighlights(context);
  return all.filter((h) => h.filePath === filePath);
}

export function addHighlight(
  context: vscode.ExtensionContext,
  highlight: Highlight
): void {
  const all = loadHighlights(context);
  all.push(highlight);
  saveHighlights(context, all);
}

export function removeHighlight(
  context: vscode.ExtensionContext,
  id: string
): void {
  const all = loadHighlights(context);
  saveHighlights(context, all.filter((h) => h.id !== id));
}

export function updateHighlight(
  context: vscode.ExtensionContext,
  id: string,
  patch: Partial<Highlight>
): void {
  const all = loadHighlights(context);
  const idx = all.findIndex((h) => h.id === id);
  if (idx !== -1) {
    all[idx] = { ...all[idx], ...patch, updatedAt: new Date().toISOString() };
    saveHighlights(context, all);
  }
}

export function setHighlightsBackgroundVisibility(
  context: vscode.ExtensionContext,
  visible: boolean
): void {
  const all = loadHighlights(context).map((highlight) => ({
    ...highlight,
    backgroundVisible: visible,
    updatedAt: new Date().toISOString(),
  }));
  saveHighlights(context, all);
}

export function removeHighlightsForFile(
  context: vscode.ExtensionContext,
  filePath: string
): void {
  const all = loadHighlights(context);
  saveHighlights(context, all.filter((h) => h.filePath !== filePath));
}
