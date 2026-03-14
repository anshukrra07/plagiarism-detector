// SentenceList.jsx  (FIXED)
// FIX [MEDIUM]: Added null/undefined guard on sentences prop.
//               Missing guard caused .map() crash if API returns unexpected shape.

import { useState } from 'react';
import FeedbackPanel from './FeedbackPanel';
import { getSourceDisplay } from '../utils/sourceDisplay';

const COLORS = {
  EXACT:      { bg: '#fde8e8', border: '#e74c3c', badge: '#e74c3c' },
  SEMANTIC:   { bg: '#fef3e2', border: '#e67e22', badge: '#e67e22' },
  PARAPHRASE: { bg: '#fef9e7', border: '#f39c12', badge: '#f39c12' },
  ORIGINAL:   { bg: '#eafaf1', border: '#27ae60', badge: '#27ae60' },
};

export default function SentenceList({ sentences, submissionId }) {
  const [expanded, setExpanded] = useState(null);

  // FIX [MEDIUM]: guard against null/undefined — was crashing the React tree
  if (!sentences?.length) return null;

  return (
    <div style={{ background: '#fff', padding: 24, borderRadius: 16,
                  boxShadow: '0 2px 16px rgba(0,0,0,0.08)' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 18, color: '#1a1a2e' }}>
        Sentence-by-Sentence Analysis
      </h3>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
        Click a flagged sentence to see matched source and rewrite suggestions.
      </p>

      {sentences.map((s, i) => {
        const c       = COLORS[s.label] || COLORS.ORIGINAL;
        const isOpen  = expanded === i;
        const flagged = s.label !== 'ORIGINAL';
        const sourceDisplay = getSourceDisplay(s);

        return (
          <div key={i} style={{ marginBottom: 8, borderRadius: 8,
            border: `1px solid ${c.border}44`, background: c.bg,
            borderLeft: `4px solid ${c.border}`, overflow: 'hidden' }}>

            <div onClick={() => flagged && setExpanded(isOpen ? null : i)}
              style={{ padding: '10px 14px', cursor: flagged ? 'pointer' : 'default',
                       display: 'flex', justifyContent: 'space-between',
                       alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 14, lineHeight: 1.5, flex: 1 }}>{s.sentence}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ padding: '2px 10px', borderRadius: 999, background: c.badge,
                               color: '#fff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {s.label} {s.score > 0 ? `${Math.round(s.score * 100)}%` : ''}
                </span>
                {flagged && <span style={{ fontSize: 12, color: '#aaa' }}>{isOpen ? '▲' : '▼'}</span>}
              </div>
            </div>

            {isOpen && flagged && (
              <div style={{ paddingLeft: 14, paddingRight: 14, paddingBottom: 4 }}>
                {s.matched_source && (
                  <div style={{ padding: '8px 12px', background: '#f0f4f8', borderRadius: 6,
                                marginBottom: 8, fontSize: 12, color: '#555', lineHeight: 1.5,
                                borderLeft: '3px solid #bdc3c7' }}>
                    <strong>Matched source:</strong> "{s.matched_source.slice(0, 200)}{s.matched_source.length > 200 ? '…' : ''}"
                  </div>
                )}
                <div style={{ fontSize: 12, color: '#666', marginBottom: 6, lineHeight: 1.5 }}>
                  {s.explanation}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#aaa',
                              marginBottom: 6, flexWrap: 'wrap' }}>
                  <span>Confidence: <strong style={{ color: '#888' }}>{s.confidence}</strong></span>
                  <span>Layer: <strong style={{ color: '#888' }}>{s.layer_hit}</strong></span>
                  {s.source_credibility && (
                    <span>Source credibility: <strong style={{ color: '#888' }}>{s.source_credibility}</strong></span>
                  )}
                  {sourceDisplay.label && sourceDisplay.href && (
                    <a href={sourceDisplay.href} target="_blank" rel="noreferrer"
                      style={{ color: '#2980b9', fontSize: 11 }}>{sourceDisplay.label} →</a>
                  )}
                  {sourceDisplay.label && !sourceDisplay.href && (
                    <span>Source: <strong style={{ color: '#888' }}>{sourceDisplay.label}</strong></span>
                  )}
                </div>
                <FeedbackPanel sentence={s} submissionId={submissionId} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
