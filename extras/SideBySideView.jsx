// src/components/SideBySideView.jsx
//
// Shows flagged sentences side-by-side:
//   LEFT  — student's sentence  (changed words highlighted in red)
//   RIGHT — matched source      (original words highlighted in green)
//
// Word-level diff is computed in the browser using a simple LCS algorithm.
// No extra libraries needed.

import { useState } from "react";
import { getSourceDisplay } from "../utils/sourceDisplay";

// ── LCS-based word diff ───────────────────────────────────────────────────────

function tokenize(text) {
  // Split into words + punctuation, preserve spaces
  return text.match(/\S+|\s+/g) || [];
}

function lcs(a, b) {
  // Longest Common Subsequence — returns 2D dp table
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1].toLowerCase() === b[j-1].toLowerCase()
        ? dp[i-1][j-1] + 1
        : Math.max(dp[i-1][j], dp[i][j-1]);
  return dp;
}

function diffWords(studentText, sourceText) {
  const aToks = tokenize(studentText);
  const bToks = tokenize(sourceText);

  // Filter to non-space tokens for LCS (spaces always match)
  const aWords = aToks.filter(t => t.trim());
  const bWords = bToks.filter(t => t.trim());

  const dp = lcs(aWords, bWords);

  // Backtrack to find which words are in common
  const aCommon = new Set();
  const bCommon = new Set();
  let i = aWords.length, j = bWords.length;
  while (i > 0 && j > 0) {
    if (aWords[i-1].toLowerCase() === bWords[j-1].toLowerCase()) {
      aCommon.add(i-1); bCommon.add(j-1); i--; j--;
    } else if (dp[i-1][j] >= dp[i][j-1]) { i--; } else { j--; }
  }

  // Build annotated token arrays
  let aIdx = 0;
  const aParts = aToks.map(tok => {
    if (!tok.trim()) return { text: tok, changed: false };
    const changed = !aCommon.has(aIdx);
    aIdx++;
    return { text: tok, changed };
  });

  let bIdx = 0;
  const bParts = bToks.map(tok => {
    if (!tok.trim()) return { text: tok, changed: false };
    const changed = !bCommon.has(bIdx);
    bIdx++;
    return { text: tok, changed };
  });

  return { aParts, bParts };
}

// ── Highlighted text renderer ─────────────────────────────────────────────────

function HighlightedText({ parts, changedColor, changedBg }) {
  return (
    <p style={styles.sentenceText}>
      {parts.map((part, i) =>
        part.changed && part.text.trim() ? (
          <mark key={i} style={{ background: changedBg, color: changedColor, borderRadius: 3, padding: "1px 2px" }}>
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </p>
  );
}

// ── Single comparison card ────────────────────────────────────────────────────

function ComparisonCard({ sentence, index }) {
  const [open, setOpen] = useState(index === 0); // first card open by default

  if (sentence.label === "ORIGINAL") return null;

  const { aParts, bParts } = diffWords(
    sentence.sentence,
    sentence.matched_source || ""
  );

  const labelColors = {
    EXACT:      { badge: "#c0392b", bg: "#fdecea" },
    SEMANTIC:   { badge: "#e67e22", bg: "#fef9e7" },
    PARAPHRASE: { badge: "#8e44ad", bg: "#f5eef8" },
  };
  const lc = labelColors[sentence.label] || labelColors.SEMANTIC;

  const scorePercent = Math.round(sentence.score * 100);
  const sourceDisplay = getSourceDisplay(sentence);

  return (
    <div style={{ ...styles.card, borderTop: `3px solid ${lc.badge}` }}>

      {/* Card header — always visible */}
      <div style={styles.cardHead} onClick={() => setOpen(o => !o)}>
        <div style={styles.headLeft}>
          <span style={{ ...styles.labelBadge, background: lc.bg, color: lc.badge }}>
            {sentence.label}
          </span>
          <span style={styles.scoreText}>{scorePercent}% similarity</span>
          <span style={{ ...styles.confBadge,
            background: sentence.confidence === "High" ? "#eafaf1" : sentence.confidence === "Medium" ? "#fef9e7" : "#f5f5f5",
            color:      sentence.confidence === "High" ? "#27ae60" : sentence.confidence === "Medium" ? "#e67e22" : "#888",
          }}>
            {sentence.confidence} confidence
          </span>
        </div>
        <span style={styles.chevron}>{open ? "▲" : "▼"}</span>
      </div>

      {/* Collapsed preview */}
      {!open && (
        <p style={styles.preview} onClick={() => setOpen(true)}>
          {sentence.sentence.slice(0, 100)}{sentence.sentence.length > 100 ? "…" : ""}
        </p>
      )}

      {/* Expanded side-by-side */}
      {open && (
        <div style={styles.body}>

          {/* Side-by-side panels */}
          <div style={styles.panels}>

            {/* LEFT — student */}
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <span style={styles.panelIcon}>👤</span>
                <span style={styles.panelTitle}>Student's text</span>
                <span style={styles.panelNote}>
                  <mark style={{ background: "#ffd6d6", borderRadius: 2, padding: "0 3px" }}>red</mark>
                  {" = changed words"}
                </span>
              </div>
              <div style={styles.panelBody}>
                {sentence.matched_source
                  ? <HighlightedText parts={aParts} changedColor="#c0392b" changedBg="#ffd6d6" />
                  : <p style={styles.sentenceText}>{sentence.sentence}</p>
                }
              </div>
            </div>

            {/* Divider */}
            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerLabel}>vs</span>
              <div style={styles.dividerLine} />
            </div>

            {/* RIGHT — source */}
            <div style={styles.panel}>
              <div style={styles.panelHeader}>
                <span style={styles.panelIcon}>📚</span>
                <span style={styles.panelTitle}>Matched source</span>
                <span style={styles.panelNote}>
                  <mark style={{ background: "#d6f5e0", borderRadius: 2, padding: "0 3px" }}>green</mark>
                  {" = original words"}
                </span>
              </div>
              <div style={styles.panelBody}>
                {sentence.matched_source
                  ? <HighlightedText parts={bParts} changedColor="#1a7a40" changedBg="#d6f5e0" />
                  : <p style={{ ...styles.sentenceText, color: "#999" }}>No matched source available.</p>
                }
              </div>
            </div>
          </div>

          {/* Explanation */}
          <div style={styles.explanation}>
            <p style={styles.explainText}>{sentence.explanation}</p>
          </div>

          {/* Footer meta */}
          <div style={styles.footer}>
            {sourceDisplay.label && sourceDisplay.href && (
              <a href={sourceDisplay.href} target="_blank" rel="noreferrer" style={styles.sourceLink}>
                {sourceDisplay.label} →
              </a>
            )}
            {sourceDisplay.label && !sourceDisplay.href && (
              <span style={styles.metaTag}>
                Source: <strong>{sourceDisplay.label}</strong>
              </span>
            )}
            {sentence.source_credibility && (
              <span style={styles.metaTag}>
                Source credibility: <strong>{sentence.source_credibility}</strong>
              </span>
            )}
            <span style={styles.metaTag}>
              Detected by Layer <strong>{sentence.layer_hit}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function SideBySideView({ sentences }) {
  const [filter, setFilter] = useState("ALL");

  if (!sentences || sentences.length === 0) return null;

  const flagged = sentences.filter(s => s.label !== "ORIGINAL");
  if (flagged.length === 0) return null;

  const counts = flagged.reduce((acc, s) => {
    acc[s.label] = (acc[s.label] || 0) + 1;
    return acc;
  }, {});

  const filtered = filter === "ALL"
    ? flagged
    : flagged.filter(s => s.label === filter);

  return (
    <div style={styles.wrap}>

      {/* Header */}
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Side-by-Side Comparison</h3>
          <p style={styles.subtitle}>
            {flagged.length} flagged sentence{flagged.length !== 1 ? "s" : ""} — student text vs matched source with word-level differences highlighted
          </p>
        </div>

        {/* Filter buttons */}
        <div style={styles.filters}>
          {[["ALL", `All (${flagged.length})`],
            ...Object.entries(counts).map(([k, v]) => [k, `${k[0]}${k.slice(1).toLowerCase()} (${v})`])
          ].map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)}
              style={{ ...styles.filterBtn, ...(filter === key ? styles.filterActive : {}) }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <mark style={{ background: "#ffd6d6", padding: "1px 6px", borderRadius: 3, fontSize: 12 }}>red word</mark>
          <span style={styles.legendText}>= word that was changed or added by student</span>
        </div>
        <div style={styles.legendItem}>
          <mark style={{ background: "#d6f5e0", padding: "1px 6px", borderRadius: 3, fontSize: 12 }}>green word</mark>
          <span style={styles.legendText}>= word from original source that was altered</span>
        </div>
        <div style={styles.legendItem}>
          <span style={styles.legendText}>Uncoloured words = identical in both texts</span>
        </div>
      </div>

      {/* Comparison cards */}
      <div style={styles.cards}>
        {filtered.map((s, i) => (
          <ComparisonCard key={i} sentence={s} index={i} />
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  wrap:        { marginBottom: 24 },
  header:      { background: "#fff", borderRadius: "12px 12px 0 0", padding: "20px 20px 0", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" },
  title:       { fontSize: 16, fontWeight: 600, color: "#111", marginBottom: 4 },
  subtitle:    { fontSize: 13, color: "#888", marginBottom: 14 },
  filters:     { display: "flex", gap: 8, paddingBottom: 0, flexWrap: "wrap", marginBottom: 0 },
  filterBtn:   { padding: "6px 14px", borderRadius: "8px 8px 0 0", border: "1px solid #ddd", borderBottom: "none", background: "#f5f5f5", cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#555" },
  filterActive:{ background: "#fff", color: "#1a56a0", borderColor: "#c3d9f7", borderBottom: "1px solid #fff", fontWeight: 600 },
  legend:      { background: "#f8f9fa", border: "1px solid #e8e8e8", borderTop: "none", padding: "10px 20px", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" },
  legendItem:  { display: "flex", alignItems: "center", gap: 6 },
  legendText:  { fontSize: 12, color: "#666" },
  cards:       { display: "flex", flexDirection: "column", gap: 12, marginTop: 12 },

  // Comparison card
  card:        { background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" },
  cardHead:    { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer", userSelect: "none" },
  headLeft:    { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  labelBadge:  { padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700 },
  scoreText:   { fontSize: 13, fontWeight: 600, color: "#444" },
  confBadge:   { padding: "2px 8px", borderRadius: 10, fontSize: 12, fontWeight: 500 },
  chevron:     { fontSize: 11, color: "#aaa" },
  preview:     { padding: "0 16px 12px", fontSize: 13, color: "#888", cursor: "pointer", fontStyle: "italic" },

  // Body
  body:        { padding: "0 16px 16px" },
  panels:      { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 0, marginBottom: 14 },
  panel:       { border: "1px solid #e8e8e8", borderRadius: 8, overflow: "hidden" },
  panelHeader: { display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "#f8f9fa", borderBottom: "1px solid #e8e8e8", flexWrap: "wrap" },
  panelIcon:   { fontSize: 14 },
  panelTitle:  { fontSize: 13, fontWeight: 600, color: "#333" },
  panelNote:   { fontSize: 11, color: "#888", marginLeft: "auto" },
  panelBody:   { padding: "12px" },
  sentenceText:{ fontSize: 14, lineHeight: 1.7, color: "#333", margin: 0 },

  // Divider
  divider:     { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 10px", gap: 6 },
  dividerLine: { flex: 1, width: 1, background: "#e0e0e0" },
  dividerLabel:{ fontSize: 11, fontWeight: 700, color: "#aaa", background: "#fff", padding: "4px 6px", borderRadius: 10, border: "1px solid #e0e0e0" },

  // Bottom
  explanation: { background: "#f8f9fa", borderRadius: 8, padding: "10px 14px", marginBottom: 10 },
  explainText: { fontSize: 13, color: "#555", lineHeight: 1.6, margin: 0 },
  footer:      { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" },
  sourceLink:  { fontSize: 13, color: "#1a56a0", textDecoration: "none", fontWeight: 500 },
  metaTag:     { fontSize: 12, color: "#888" },
};
