// ResultsView.jsx — Single unified view. No tabs. All features at once.
//
// ┌─ Header: score chips + filter buttons + legend ──────────────────────┐
// ├─ Document prose (left) ────────────┬─ Detail panel (right) ──────────┤
// │  Georgia serif, flowing text       │  Opens when any sentence is     │
// │  · colour highlights + underline   │  clicked. Contains:             │
// │  · score superscript badges        │  · label / score / confidence   │
// │  · hover tooltip                   │  · word-level LCS diff          │
// │  · active sentence outlined        │  · matched source quote         │
// │  · dimmed when filter active       │  · source link                  │
// │                                    │  · explanation                  │
// ├─ Sentence index (below prose) ─────┤  · rewrite suggestions          │
// │  ALL sentences listed (incl. ORIG) │  · download PDF report          │
// │  with label badge + score          │                                 │
// │  Filter chips narrow this list     │                                 │
// │  AND dim prose to matching only    │                                 │
// └────────────────────────────────────┴─────────────────────────────────┘

import { useState, useRef, useMemo } from 'react';
import FeedbackPanel from './FeedbackPanel';
import { getSourceDisplay } from '../utils/sourceDisplay';

// ─── Config ───────────────────────────────────────────────────────────────────

const CFG = {
  EXACT:      { bg: '#fde8e8', border: '#e74c3c', badge: '#e74c3c', label: 'Exact match'  },
  SEMANTIC:   { bg: '#fef3e2', border: '#e67e22', badge: '#e67e22', label: 'Semantic'      },
  PARAPHRASE: { bg: '#fef9e7', border: '#f39c12', badge: '#f39c12', label: 'Paraphrase'    },
  ORIGINAL:   { bg: '#eafaf1', border: '#27ae60', badge: '#27ae60', label: 'Original'      },
};

// ─── LCS word diff ────────────────────────────────────────────────────────────

function tokenize(text) { return (text || '').match(/\S+|\s+/g) || []; }

function buildDiff(a, b) {
  if (!b) return {
    aParts: tokenize(a).map(t => ({ text: t, changed: false })),
    bParts: [],
  };
  const aToks = tokenize(a), bToks = tokenize(b);
  const aW = aToks.filter(t => t.trim()), bW = bToks.filter(t => t.trim());
  const R = aW.length + 1, C = bW.length + 1;
  const dp = new Array(R * C).fill(0);
  for (let i = 1; i < R; i++)
    for (let j = 1; j < C; j++)
      dp[i*C+j] = aW[i-1].toLowerCase() === bW[j-1].toLowerCase()
        ? dp[(i-1)*C+(j-1)] + 1
        : Math.max(dp[(i-1)*C+j], dp[i*C+(j-1)]);
  const aOk = new Set(), bOk = new Set();
  let i = aW.length, j = bW.length;
  while (i > 0 && j > 0) {
    if (aW[i-1].toLowerCase() === bW[j-1].toLowerCase()) { aOk.add(i-1); bOk.add(j-1); i--; j--; }
    else if (dp[(i-1)*C+j] >= dp[i*C+(j-1)]) i--; else j--;
  }
  let ai = 0, bi = 0;
  return {
    aParts: aToks.map(t => ({ text: t, changed: t.trim() ? !aOk.has(ai++) : false })),
    bParts: bToks.map(t => ({ text: t, changed: t.trim() ? !bOk.has(bi++) : false })),
  };
}

function DiffText({ parts, changedColor, changedBg }) {
  return (
    <p style={{ fontSize: 13, lineHeight: 1.7, color: '#333', margin: 0 }}>
      {parts.map((p, i) =>
        p.changed && p.text.trim()
          ? <mark key={i} style={{ background: changedBg, color: changedColor, borderRadius: 3, padding: '0 2px' }}>{p.text}</mark>
          : <span key={i}>{p.text}</span>
      )}
    </p>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ s, submissionId, onClose, onReplaceSentence }) {
  const cfg  = CFG[s.label] || CFG.ORIGINAL;
  const src  = getSourceDisplay(s);
  const { aParts, bParts } = useMemo(() => buildDiff(s.sentence, s.matched_source), [s.sentence, s.matched_source]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
          <span style={{ padding: '3px 12px', borderRadius: 20, fontWeight: 700, fontSize: 13,
                         background: cfg.bg, color: cfg.badge, border: `1px solid ${cfg.border}55` }}>
            {s.label}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#444' }}>
            {Math.round(s.score * 100)}% similarity
          </span>
          <span style={{
            padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 500,
            background: s.confidence === 'High' ? '#eafaf1' : s.confidence === 'Medium' ? '#fef9e7' : '#f5f5f5',
            color:      s.confidence === 'High' ? '#1e8449' : s.confidence === 'Medium' ? '#d35400' : '#888',
          }}>{s.confidence} confidence</span>
          <span style={{ fontSize: 11, color: '#aaa', background: '#f0f0f0', borderRadius: 5, padding: '2px 6px' }}>
            Layer {s.layer_hit}
          </span>
          {s.source_credibility && (
            <span style={{ fontSize: 11, color: '#888' }}>{s.source_credibility} credibility</span>
          )}
        </div>
        <button onClick={onClose} style={{
          flexShrink: 0, border: 'none', background: '#ebebeb', borderRadius: '50%',
          width: 26, height: 26, cursor: 'pointer', fontSize: 14, color: '#777',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>
      </div>

      {/* Flagged sentence (for reference) */}
      <div style={{ background: `${cfg.bg}cc`, borderRadius: 8, padding: '10px 13px', borderLeft: `3px solid ${cfg.border}` }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 5 }}>
          Flagged sentence
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#333', lineHeight: 1.6 }}>{s.sentence}</p>
      </div>

      {/* Word-level diff */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 8 }}>
          Word-level comparison
        </div>
        {s.matched_source ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 22px 1fr', borderRadius: 8, overflow: 'hidden', border: '1px solid #e8e8e8' }}>
            <div>
              <div style={{ padding: '5px 10px', background: '#fef7f7', borderBottom: '1px solid #e8e8e8', fontSize: 11, fontWeight: 600, color: '#c0392b', display: 'flex', justifyContent: 'space-between' }}>
                <span>👤 Student</span>
                <span style={{ fontWeight: 400, color: '#bbb' }}>
                  <mark style={{ background: '#ffd6d6', padding: '0 3px', borderRadius: 2 }}>red</mark> = changed
                </span>
              </div>
              <div style={{ padding: 10 }}>
                <DiffText parts={aParts} changedColor="#c0392b" changedBg="#ffd6d6" />
              </div>
            </div>
            <div style={{ background: '#f5f5f5', borderLeft: '1px solid #e8e8e8', borderRight: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 10, color: '#bbb', fontWeight: 700 }}>vs</span>
            </div>
            <div>
              <div style={{ padding: '5px 10px', background: '#f7fef9', borderBottom: '1px solid #e8e8e8', fontSize: 11, fontWeight: 600, color: '#1e8449', display: 'flex', justifyContent: 'space-between' }}>
                <span>📚 Source</span>
                <span style={{ fontWeight: 400, color: '#bbb' }}>
                  <mark style={{ background: '#d6f5e0', padding: '0 3px', borderRadius: 2 }}>green</mark> = original
                </span>
              </div>
              <div style={{ padding: 10 }}>
                <DiffText parts={bParts} changedColor="#1a7a40" changedBg="#d6f5e0" />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '10px 13px', color: '#aaa', fontSize: 13 }}>
            No matched source sentence available.
          </div>
        )}
      </div>

      {/* Explanation + source */}
      <div style={{ background: '#f8f9fa', borderRadius: 8, padding: '10px 13px' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#aaa', marginBottom: 5 }}>
          Why flagged
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#444', lineHeight: 1.6 }}>{s.explanation}</p>
        {src.label && (
          <div style={{ marginTop: 7 }}>
            {src.href
              ? <a href={src.href} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#2980b9', fontWeight: 500 }}>{src.label} →</a>
              : <span style={{ fontSize: 12, color: '#666' }}>Source: <strong>{src.label}</strong></span>
            }
          </div>
        )}
      </div>

      {/* FeedbackPanel */}
      <FeedbackPanel sentence={s} submissionId={submissionId} onReplaceSentence={onReplaceSentence} />
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function ResultsView({ sentences: initialSentences, submissionId }) {
  const [sentences, setSentences] = useState(initialSentences);
  const [selected,  setSelected]  = useState(null);
  const [filter,    setFilter]    = useState('ALL');
  const sentenceRefs = useRef({});

  if (!sentences?.length) return null;

  const flagged    = sentences.filter(s => s.label !== 'ORIGINAL');
  const counts     = flagged.reduce((a, s) => ({ ...a, [s.label]: (a[s.label] || 0) + 1 }), {});
  const panelOpen  = selected !== null;
  const selectedS  = panelOpen ? sentences[selected] : null;

  const listItems  = filter === 'ALL' ? sentences : sentences.filter(s => s.label === filter || s.label === 'ORIGINAL');

  function handleSelect(idx) {
    setSelected(prev => prev === idx ? null : idx);
    setTimeout(() => {
      const el = sentenceRefs.current[idx];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }

  function handleReplaceSentence(newText) {
    if (selected === null) return;
    setSentences(prev => {
      const updated = [...prev];
      updated[selected] = { ...updated[selected], sentence: newText };
      return updated;
    });
  }

  return (
    <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 2px 16px rgba(0,0,0,0.08)', marginBottom: 24, overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: '0 0 2px', fontSize: 18, fontWeight: 700, color: '#1a1a2e' }}>Analysis Results</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#888' }}>
              {flagged.length} flagged · {sentences.length - flagged.length} original · {sentences.length} total
            </p>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {Object.entries(counts).map(([lbl, n]) => (
              <span key={lbl} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                                       background: CFG[lbl].bg, color: CFG[lbl].badge, border: `1px solid ${CFG[lbl].border}55` }}>
                {n} {lbl.charAt(0) + lbl.slice(1).toLowerCase()}
              </span>
            ))}
          </div>
        </div>

        {/* Filter row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#aaa', marginRight: 4 }}>Filter list:</span>
          {[['ALL', `All (${sentences.length})`],
            ...Object.entries(counts).map(([k, v]) => [k, `${k.charAt(0) + k.slice(1).toLowerCase()} (${v})`])
          ].map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} style={{
              padding: '4px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              border: `1px solid ${key === 'ALL' ? '#ddd' : CFG[key]?.border + '77' || '#ddd'}`,
              background: filter === key ? (key === 'ALL' ? '#1a56a0' : CFG[key]?.badge || '#555') : '#f5f5f5',
              color:      filter === key ? '#fff' : '#555',
            }}>{label}</button>
          ))}

          {/* Legend (right side) */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {Object.entries(CFG).filter(([k]) => k !== 'ORIGINAL').map(([k, c]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: c.badge, display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: '#888' }}>{c.label}</span>
              </div>
            ))}
            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 4 }}>
              <mark style={{ background: '#ffd6d6', padding: '0 3px', borderRadius: 2 }}>red</mark>
              {' / '}
              <mark style={{ background: '#d6f5e0', padding: '0 3px', borderRadius: 2 }}>green</mark>
              {' word diff'}
            </span>
          </div>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div style={{ display: 'grid', gridTemplateColumns: panelOpen ? '1fr 420px' : '1fr' }}>

        {/* LEFT: prose + sentence list */}
        <div style={{ borderRight: panelOpen ? '1px solid #f0f0f0' : 'none', overflow: 'auto', maxHeight: 700 }}>

          {/* Prose */}
          <div style={{ padding: '22px 26px 14px', fontFamily: 'Georgia, serif', fontSize: 15, lineHeight: 2.3, color: '#2c3e50' }}>
            {sentences.map((s, i) => {
              const c       = CFG[s.label] || CFG.ORIGINAL;
              const flagged = s.label !== 'ORIGINAL';
              const active  = selected === i;
              const dimmed  = filter !== 'ALL' && s.label !== filter && s.label !== 'ORIGINAL';
              return (
                <span key={i}>
                  <span
                    ref={el => { sentenceRefs.current[i] = el; }}
                    onClick={() => flagged && handleSelect(i)}
                    title={flagged ? `${s.label} · ${Math.round(s.score * 100)}% · click to inspect` : undefined}
                    style={{
                      cursor:       flagged ? 'pointer' : 'text',
                      background:   active  ? c.badge + '28' : flagged ? c.bg : 'transparent',
                      borderBottom: flagged ? `2px solid ${c.border}` : 'none',
                      borderRadius: 2,
                      padding:      flagged ? '1px 2px' : 0,
                      outline:      active  ? `2px solid ${c.badge}` : 'none',
                      outlineOffset: 2,
                      opacity:      dimmed  ? 0.28 : 1,
                      transition:   'all 0.15s',
                    }}
                  >
                    {s.sentence}
                    {flagged && (
                      <sup style={{
                        fontSize: 9, fontWeight: 700, color: '#fff',
                        background: c.badge, borderRadius: 8,
                        padding: '1px 4px', marginLeft: 2,
                      }}>{Math.round(s.score * 100)}%</sup>
                    )}
                  </span>
                  {' '}
                </span>
              );
            })}
          </div>

          {/* Sentence index list */}
          <div style={{ borderTop: '1px solid #f0f0f0', padding: '14px 22px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#bbb', marginBottom: 8 }}>
              Sentence index
              {filter !== 'ALL' && (
                <span style={{ fontWeight: 400, marginLeft: 6, color: '#ccc' }}>
                  · filtered to {filter.charAt(0) + filter.slice(1).toLowerCase()} + original
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {listItems.map((s) => {
                const idx    = sentences.indexOf(s);
                const c      = CFG[s.label] || CFG.ORIGINAL;
                const active = selected === idx;
                const isFlag = s.label !== 'ORIGINAL';
                return (
                  <div key={idx}
                    onClick={() => isFlag && handleSelect(idx)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px',
                      borderRadius: 7, cursor: isFlag ? 'pointer' : 'default',
                      background:   active ? c.bg : 'transparent',
                      borderTop:    active ? `1px solid ${c.border}44` : '1px solid transparent',
                      borderRight:  active ? `1px solid ${c.border}44` : '1px solid transparent',
                      borderBottom: active ? `1px solid ${c.border}44` : '1px solid transparent',
                      borderLeft:   `3px solid ${c.border}`,
                      transition:   'background 0.12s',
                    }}
                  >
                    <span style={{
                      flexShrink: 0, padding: '1px 7px', borderRadius: 999,
                      background: c.badge, color: '#fff',
                      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', marginTop: 2,
                    }}>
                      {isFlag
                        ? `${s.label.charAt(0) + s.label.slice(1).toLowerCase()} ${Math.round(s.score * 100)}%`
                        : `Orig ${Math.round(s.score * 100)}%`}
                    </span>
                    <span style={{
                      fontSize: 12, lineHeight: 1.5, color: active ? '#333' : '#666',
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    }}>
                      {s.sentence}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT: detail panel */}
        {panelOpen && selectedS && (
          <div style={{ padding: '20px 18px', overflow: 'auto', maxHeight: 700, background: '#fafbfc' }}>
            <DetailPanel s={selectedS} submissionId={submissionId} onClose={() => setSelected(null)} onReplaceSentence={handleReplaceSentence} />
          </div>
        )}
      </div>

      {/* Click hint */}
      {!panelOpen && flagged.length > 0 && (
        <div style={{ textAlign: 'center', padding: '8px 24px 14px', fontSize: 12, color: '#ccc' }}>
          Click any highlighted sentence to inspect — word diff, explanation, and rewrite suggestions will appear here
        </div>
      )}
    </div>
  );
}