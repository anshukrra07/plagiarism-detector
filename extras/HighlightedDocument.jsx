// HighlightedDocument.jsx
// Renders the full document as flowing text with flagged sentences highlighted inline.
//
// Colour key:
//   EXACT      → red   (#fde8e8 background, #e74c3c underline)
//   SEMANTIC   → orange (#fef3e2 background, #e67e22 underline)
//   PARAPHRASE → yellow (#fef9e7 background, #f39c12 underline)
//   ORIGINAL   → no highlight
//
// Clicking a flagged sentence expands an inline panel showing:
//   - matched source quote
//   - explanation
//   - FeedbackPanel (rewrite suggestions + PDF download)

import { useState } from 'react';
import FeedbackPanel from './FeedbackPanel';
import { getSourceDisplay } from '../utils/sourceDisplay';

const CONFIG = {
  EXACT:      { bg: '#fde8e8', underline: '#e74c3c', badge: '#e74c3c', label: 'Exact match'  },
  SEMANTIC:   { bg: '#fef3e2', underline: '#e67e22', badge: '#e67e22', label: 'Semantic'      },
  PARAPHRASE: { bg: '#fef9e7', underline: '#f39c12', badge: '#f39c12', label: 'Paraphrase'    },
};

export default function HighlightedDocument({ sentences, submissionId }) {
  const [expanded, setExpanded] = useState(null);

  if (!sentences?.length) return null;

  const flaggedCount = sentences.filter(s => s.label !== 'ORIGINAL').length;

  return (
    <div style={styles.wrap}>
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>Highlighted Document View</h3>
        <p style={styles.subtitle}>
          {flaggedCount} flagged sentence{flaggedCount !== 1 ? 's' : ''} · Click any highlighted sentence to see details and rewrite suggestions
        </p>
        {/* Colour legend */}
        <div style={styles.legend}>
          {Object.entries(CONFIG).map(([label, cfg]) => (
            <div key={label} style={styles.legendItem}>
              <span style={{ ...styles.legendSwatch, background: cfg.bg, borderBottom: `2px solid ${cfg.underline}` }}>
                Aa
              </span>
              <span style={styles.legendText}>{cfg.label}</span>
            </div>
          ))}
          <div style={styles.legendItem}>
            <span style={{ ...styles.legendSwatch, background: 'transparent', color: '#999' }}>Aa</span>
            <span style={styles.legendText}>Original</span>
          </div>
        </div>
      </div>

      {/* Document body */}
      <div style={styles.body}>
        {sentences.map((s, i) => {
          const cfg     = CONFIG[s.label];
          const flagged = !!cfg;
          const isOpen  = expanded === i;
          const sourceDisplay = getSourceDisplay(s);

          return (
            <span key={i}>
              {/* The sentence itself */}
              <span
                onClick={() => flagged && setExpanded(isOpen ? null : i)}
                title={flagged ? `${s.label} · ${Math.round(s.score * 100)}% similarity · click for details` : undefined}
                style={{
                  lineHeight:      2.2,
                  cursor:          flagged ? 'pointer' : 'text',
                  background:      flagged ? cfg.bg : 'transparent',
                  borderBottom:    flagged ? `2px solid ${cfg.underline}` : 'none',
                  borderRadius:    flagged ? 2 : 0,
                  padding:         flagged ? '1px 2px' : 0,
                  transition:      'background 0.15s',
                  position:        'relative',
                }}
              >
                {s.sentence}
                {/* Score badge */}
                {flagged && (
                  <sup style={{
                    fontSize: 9, fontWeight: 700, color: '#fff',
                    background: cfg.badge, borderRadius: 8,
                    padding: '1px 4px', marginLeft: 2, verticalAlign: 'super',
                  }}>
                    {Math.round(s.score * 100)}%
                  </sup>
                )}
              </span>

              {/* Inline expansion panel — appears right after the clicked sentence */}
              {isOpen && flagged && (
                <span style={{ display: 'block', margin: '8px 0 12px' }}>
                  <div style={{
                    background: '#fff',
                    border: `1px solid ${cfg.underline}44`,
                    borderLeft: `4px solid ${cfg.underline}`,
                    borderRadius: 8,
                    padding: '12px 16px',
                    fontSize: 13,
                  }}>
                    {/* Label + score row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{
                        background: cfg.bg, color: cfg.badge,
                        border: `1px solid ${cfg.underline}44`,
                        borderRadius: 12, padding: '2px 10px',
                        fontWeight: 700, fontSize: 12,
                      }}>
                        {s.label}
                      </span>
                      <span style={{ fontSize: 12, color: '#888' }}>
                        {Math.round(s.score * 100)}% similarity · {s.confidence} confidence · Layer {s.layer_hit}
                      </span>
                      {s.source_credibility && (
                        <span style={{ fontSize: 12, color: '#888' }}>
                          · Source: <strong>{s.source_credibility}</strong> credibility
                        </span>
                      )}
                      <button
                        onClick={() => setExpanded(null)}
                        style={{ marginLeft: 'auto', border: 'none', background: 'none',
                                 cursor: 'pointer', color: '#aaa', fontSize: 16, lineHeight: 1 }}
                      >
                        ✕
                      </button>
                    </div>

                    {/* Matched source */}
                    {s.matched_source && (
                      <div style={{
                        background: '#f8f9fa', borderRadius: 6, padding: '8px 12px',
                        marginBottom: 8, borderLeft: '3px solid #bdc3c7', color: '#555',
                      }}>
                        <strong style={{ fontSize: 11, textTransform: 'uppercase',
                                         letterSpacing: 1, color: '#999' }}>Matched source</strong>
                        <p style={{ margin: '4px 0 0', lineHeight: 1.6 }}>
                          "{s.matched_source.slice(0, 250)}{s.matched_source.length > 250 ? '…' : ''}"
                        </p>
                        {sourceDisplay.label && (
                          sourceDisplay.href ? (
                            <a href={sourceDisplay.href} target="_blank" rel="noreferrer"
                              style={{ fontSize: 12, color: '#2980b9', marginTop: 4, display: 'inline-block' }}>
                              {sourceDisplay.label} →
                            </a>
                          ) : (
                            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                              Source: <strong>{sourceDisplay.label}</strong>
                            </div>
                          )
                        )}
                      </div>
                    )}

                    {/* Explanation */}
                    <p style={{ margin: '0 0 8px', color: '#555', lineHeight: 1.6 }}>
                      {s.explanation}
                    </p>

                    {/* FeedbackPanel — rewrite suggestions + PDF download */}
                    <FeedbackPanel sentence={s} submissionId={submissionId} />
                  </div>
                </span>
              )}

              {/* Space between sentences */}
              {' '}
            </span>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    background: '#fff', borderRadius: 16,
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)', marginBottom: 24, overflow: 'hidden',
  },
  header: {
    padding: '20px 24px 16px', borderBottom: '1px solid #f0f0f0',
  },
  title: { fontSize: 18, fontWeight: 700, color: '#1a1a2e', margin: '0 0 4px' },
  subtitle: { fontSize: 13, color: '#888', margin: '0 0 14px' },
  legend: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6 },
  legendSwatch: {
    fontSize: 12, fontWeight: 700, padding: '1px 6px',
    borderRadius: 3, display: 'inline-block',
  },
  legendText: { fontSize: 12, color: '#666' },
  body: {
    padding: '24px 28px', fontFamily: 'Georgia, serif',
    fontSize: 15, lineHeight: 2.2, color: '#2c3e50',
  },
};
