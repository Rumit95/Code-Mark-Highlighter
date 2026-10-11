// src/highlightMatcher.ts
// Content-based matching: finds where a stored highlight lives in the current document
// Uses exact hash match first, then fuzzy substring search as fallback.

import * as vscode from "vscode";
import * as crypto from "crypto";

export function hashText(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Attempt to find the range in `document` where `snippet` lives.
 * Strategy:
 *  1. Exact text search (fast, handles whitespace normalization)
 *  2. Fuzzy search using sliding window similarity (handles minor edits)
 *
 * Returns null if no sufficiently similar region is found.
 */
export function findRangeInDocument(
  document: vscode.TextDocument,
  snippet: string,
  storedHash: string,
  fuzzyThreshold: number = 0.75,
  contextBefore: string = "",
  contextAfter: string = ""
): vscode.Range | null {
  const docText = document.getText();

  // --- 1. Exact match (fastest) ---
  const exactIdx = findBestExactMatch(
    docText,
    snippet,
    contextBefore,
    contextAfter
  );
  if (exactIdx !== -1) {
    const start = document.positionAt(exactIdx);
    const end = document.positionAt(exactIdx + snippet.length);
    return new vscode.Range(start, end);
  }

  // --- 2. Normalized whitespace match ---
  const normalSnippet = normalizeWhitespace(snippet);
  const normalDoc = normalizeWhitespace(docText);
  const normalIdx = normalDoc.indexOf(normalSnippet);
  if (normalIdx !== -1) {
    // Map normalized index back to original document position
    const origIdx = mapNormalizedToOriginal(docText, normalIdx);
    if (origIdx !== -1) {
      const start = document.positionAt(origIdx);
      const end = document.positionAt(origIdx + snippet.length);
      return new vscode.Range(start, end);
    }
  }

  // --- 3. Fuzzy sliding-window search ---
  // Only do this for reasonably sized snippets (avoid O(n^2) on huge files)
  const snippetLen = snippet.length;
  const docLen = docText.length;

  if (snippetLen < 10 || snippetLen > 5000) {
    return null;
  }

  // Search in blocks: use line-granularity to find candidate regions
  const snippetLines = snippet.split("\n");
  const firstLine = snippetLines[0].trim();
  const lastLine = snippetLines[snippetLines.length - 1].trim();

  if (!firstLine) { return null; }

  // Find candidate starting lines
  let bestRange: vscode.Range | null = null;
  let bestScore = 0;

  for (let lineIdx = 0; lineIdx < document.lineCount; lineIdx++) {
    const lineText = document.lineAt(lineIdx).text.trim();

    // Quick filter: first line must be at least 60% similar
    if (firstLine.length > 3 && similarity(lineText, firstLine) < 0.6) {
      continue;
    }

    // Found a candidate start — extract the same number of lines
    const endLineIdx = Math.min(
      lineIdx + snippetLines.length - 1,
      document.lineCount - 1
    );
    const candidateStart = document.lineAt(lineIdx).range.start;
    const candidateEnd = document.lineAt(endLineIdx).range.end;
    const candidate = document.getText(new vscode.Range(candidateStart, candidateEnd));

    const score = similarity(candidate, snippet);
    if (score > bestScore && score >= fuzzyThreshold) {
      bestScore = score;

      // Narrow the range to just the matching content (trim leading/trailing whitespace diff)
      const trimmedCandidate = candidate.trimStart();
      const leadingWhitespace = candidate.length - trimmedCandidate.length;
      const adjustedStart = document.positionAt(
        document.offsetAt(candidateStart) + leadingWhitespace
      );
      bestRange = new vscode.Range(adjustedStart, candidateEnd);
    }
  }

  if (bestRange) {
    return bestRange;
  }

  // --- 4. Hash match on lines (handles reformatting) ---
  // Try hashing each line-group of the same size as the snippet lines
  const snippetLineCount = snippetLines.length;
  for (let i = 0; i <= document.lineCount - snippetLineCount; i++) {
    const start = document.lineAt(i).range.start;
    const end = document.lineAt(i + snippetLineCount - 1).range.end;
    const block = document.getText(new vscode.Range(start, end));
    if (hashText(block) === storedHash) {
      return new vscode.Range(start, end);
    }
  }

  return null;
}

function findBestExactMatch(
  documentText: string,
  snippet: string,
  contextBefore: string,
  contextAfter: string
): number {
  let bestIndex = -1;
  let bestScore = -1;
  let searchFrom = 0;

  while (searchFrom <= documentText.length - snippet.length) {
    const index = documentText.indexOf(snippet, searchFrom);
    if (index === -1) { break; }

    if (!contextBefore && !contextAfter) { return index; }

    const before = documentText.slice(
      Math.max(0, index - contextBefore.length),
      index
    );
    const afterStart = index + snippet.length;
    const after = documentText.slice(afterStart, afterStart + contextAfter.length);
    const score = scoreContext(before, after, contextBefore, contextAfter);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }

    searchFrom = index + 1;
  }

  return bestIndex;
}

function scoreContext(
  actualBefore: string,
  actualAfter: string,
  expectedBefore: string,
  expectedAfter: string
): number {
  let total = 0;
  let count = 0;

  if (expectedBefore) {
    total += contextSimilarity(actualBefore, expectedBefore);
    count++;
  }
  if (expectedAfter) {
    total += contextSimilarity(actualAfter, expectedAfter);
    count++;
  }

  return count === 0 ? 0 : total / count;
}

function contextSimilarity(actual: string, expected: string): number {
  const normalizedActual = normalizeWhitespace(actual);
  const normalizedExpected = normalizeWhitespace(expected);
  if (normalizedActual.length < 3 || normalizedExpected.length < 3) {
    return normalizedActual === normalizedExpected ? 1 : 0;
  }
  return similarity(normalizedActual, normalizedExpected);
}

/**
 * Similarity ratio between two strings using a simple character n-gram approach.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function similarity(a: string, b: string): number {
  if (a === b) { return 1; }
  if (a.length === 0 || b.length === 0) { return 0; }

  // Use trigram similarity for efficiency
  const trigramsA = getTrigrams(a);
  const trigramsB = getTrigrams(b);

  if (trigramsA.size === 0 && trigramsB.size === 0) { return 1; }
  if (trigramsA.size === 0 || trigramsB.size === 0) { return 0; }

  let intersection = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) { intersection++; }
  }

  return (2 * intersection) / (trigramsA.size + trigramsB.size);
}

function getTrigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/\s+/g, " ");
  const trigrams = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) {
    trigrams.add(s.slice(i, i + 3));
  }
  return trigrams;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");
}

function mapNormalizedToOriginal(original: string, normalizedIdx: number): number {
  // Walk through original counting normalized characters
  let normalCount = 0;
  let i = 0;
  while (i < original.length && normalCount < normalizedIdx) {
    const ch = original[i];
    if (ch === "\r" && original[i + 1] === "\n") {
      i += 2;
      normalCount++;
    } else if (ch === " " || ch === "\t") {
      // Skip consecutive spaces/tabs (they become one space in normalized)
      while (i < original.length && (original[i] === " " || original[i] === "\t")) {
        i++;
      }
      normalCount++;
    } else {
      i++;
      normalCount++;
    }
  }
  return i < original.length ? i : -1;
}
