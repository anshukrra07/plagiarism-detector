// NetworkGraph.jsx — Network graph + batch upload panel unified
// Features added:
//   - BatchUploadPanel built in (above the graph)
//   - Submission timestamps → arrow direction (copier → original)
//   - Sentence ownership panel per pair
//   - Edit distance / modification level per flagged sentence

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const API = 'http://localhost:8000';

const CLUSTER_COLORS = [
  '#e74c3c', '#8e44ad', '#2980b9', '#16a085',
  '#d35400', '#27ae60', '#c0392b', '#1abc9c',
];
const UNCLUSTERED_COLOR = '#95a5a6';

function clusterColor(clusterId) {
  if (clusterId === -1 || clusterId === undefined || clusterId === null)
    return UNCLUSTERED_COLOR;
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
}

// ── BatchUploadPanel (built-in) ───────────────────────────────────────────────
//
// Multi-file drop zone: user drops N files at once.
// Files are auto-named S1, S2, S3... in drop order.
// User can rename any student after dropping.
// Also supports adding students one-by-one with text paste or single file.

function BatchUploadPanel({ onDone }) {
  const [students,   setStudents]   = useState([]);
  const [threshold,  setThreshold]  = useState(0.65);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [result,     setResult]     = useState(null);
  const [open,       setOpen]       = useState(true);
  const [dragging,   setDragging]   = useState(false);
  const [namePrompt, setNamePrompt] = useState(null); // {index, currentName}
  const dropRef = useRef(null);

  // ── Auto-name helper ──────────────────────────────────────────────────────
  function nextName(existing) {
    // Find next available S-number not already used
    const used = new Set(existing.map(s => s.name));
    let n = existing.length + 1;
    while (used.has(`S${n}`)) n++;
    return `S${n}`;
  }

  // ── Add files (from drop or file input) ──────────────────────────────────
  function addFiles(files) {
    const arr = Array.from(files).filter(f =>
      /\.(pdf|docx|txt)$/i.test(f.name)
    );
    if (!arr.length) return;
    setStudents(prev => {
      const next = [...prev];
      arr.forEach(file => {
        next.push({
          name:      nextName(next),
          file,
          text:      '',
          mode:      'file',
          timestamp: new Date().toISOString().slice(0, 16),
        });
      });
      return next;
    });
  }

  // ── Drag and drop handlers ────────────────────────────────────────────────
  function onDragOver(e) { e.preventDefault(); setDragging(true); }
  function onDragLeave(e) { if (!dropRef.current?.contains(e.relatedTarget)) setDragging(false); }
  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  // ── Student management ────────────────────────────────────────────────────
  function updateStudent(i, field, val) {
    setStudents(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  }

  function removeStudent(i) {
    setStudents(prev => prev.filter((_, idx) => idx !== i));
  }

  function addManual() {
    setStudents(prev => {
      const name = nextName(prev);
      return [...prev, { name, file: null, text: '', mode: 'text', timestamp: new Date().toISOString().slice(0, 16) }];
    });
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    setError('');
    const valid = students.filter(s =>
      s.name.trim() && (
        (s.mode === 'text' && s.text.trim().length >= 30) ||
        (s.mode === 'file' && s.file)
      )
    );
    if (valid.length < 2) {
      setError('Need at least 2 students with name + content (text ≥30 chars or file).');
      return;
    }
    setLoading(true);
    try {
      // Resolve all files to text
      const resolved = await Promise.all(valid.map(async s => {
        if (s.mode === 'text') return { ...s, resolvedText: s.text.trim() };
        const file = s.file;
        if (file.name.endsWith('.txt')) {
          const text = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload  = e => res(e.target.result);
            r.onerror = () => rej(new Error(`Could not read ${file.name}`));
            r.readAsText(file);
          });
          return { ...s, resolvedText: text };
        } else {
          // PDF or DOCX — extract server-side
          const form = new FormData();
          form.append('file', file);
          form.append('auto_fetch_corpus', 'false');
          const res = await fetch(`${API}/check/file`, { method: 'POST', body: form });
          if (!res.ok) throw new Error(`Failed to extract ${file.name}`);
          const data = await res.json();
          return { ...s, resolvedText: (data.sentences || []).map(x => x.sentence).join(' ') };
        }
      }));

      const res = await fetch(`${API}/compare/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texts:      resolved.map(s => s.resolvedText),
          labels:     resolved.map(s => s.name.trim()),
          threshold,
          timestamps: resolved.map(s => s.timestamp || new Date().toISOString()),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || `Error ${res.status}`);
      const data = await res.json();
      setResult(data);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const readyCount = students.filter(s =>
    s.name.trim() && ((s.mode === 'text' && s.text.trim().length >= 30) || (s.mode === 'file' && s.file))
  ).length;

  return (
    <div style={bs.wrap}>

      {/* Header — collapsible */}
      <div style={bs.head} onClick={() => setOpen(o => !o)}>
        <span style={bs.headTitle}>📤 Batch Student Submission</span>
        <span style={bs.headSub}>Drop multiple files or paste text to compare students</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <>
          {/* Threshold slider */}
          <div style={bs.threshRow}>
            <span style={bs.threshLabel}>Similarity threshold: <strong>{Math.round(threshold * 100)}%</strong></span>
            <input type="range" min="0.4" max="0.95" step="0.05" value={threshold}
              onChange={e => setThreshold(parseFloat(e.target.value))}
              style={{ flex: 1, cursor: 'pointer' }} />
            <span style={bs.threshHint}>Lower = catch more pairs</span>
          </div>

          {/* Drop zone */}
          <div
            ref={dropRef}
            onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            style={{ ...bs.dropZone, ...(dragging ? bs.dropZoneActive : {}) }}
          >
            <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
            <div style={{ fontWeight: 600, color: '#333', marginBottom: 4 }}>
              Drop multiple student files here
            </div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
              PDF, DOCX, or TXT · Each file becomes one student · Auto-named S1, S2, S3...
            </div>
            <label style={bs.browseBtn}>
              Browse files
              <input type="file" multiple accept=".pdf,.docx,.txt"
                style={{ display: 'none' }}
                onChange={e => addFiles(e.target.files)} />
            </label>
          </div>

          {/* Student list */}
          {students.length > 0 && (
            <div style={bs.studentList}>
              <div style={bs.listHeader}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                  {students.length} student{students.length !== 1 ? 's' : ''} queued
                </span>
                <span style={{ fontSize: 12, color: '#888' }}>
                  Click a name to rename · ✕ to remove
                </span>
              </div>

              {students.map((st, i) => (
                <div key={i} style={bs.studentRow}>
                  {/* Index badge */}
                  <div style={bs.indexBadge}>{i + 1}</div>

                  {/* Name — click to rename */}
                  {namePrompt?.index === i ? (
                    <input
                      autoFocus
                      value={namePrompt.currentName}
                      onChange={e => setNamePrompt({ index: i, currentName: e.target.value })}
                      onBlur={() => {
                        if (namePrompt.currentName.trim())
                          updateStudent(i, 'name', namePrompt.currentName.trim());
                        setNamePrompt(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          if (namePrompt.currentName.trim())
                            updateStudent(i, 'name', namePrompt.currentName.trim());
                          setNamePrompt(null);
                        }
                        if (e.key === 'Escape') setNamePrompt(null);
                      }}
                      style={bs.nameEditInput}
                    />
                  ) : (
                    <div style={bs.nameTag}
                      onClick={() => setNamePrompt({ index: i, currentName: st.name })}
                      title="Click to rename">
                      {st.name}
                      <span style={{ fontSize: 10, color: '#aaa', marginLeft: 4 }}>✎</span>
                    </div>
                  )}

                  {/* File/text indicator */}
                  <div style={bs.fileInfo}>
                    {st.mode === 'file' && st.file ? (
                      <>
                        <span style={bs.fileIcon}>📄</span>
                        <span style={bs.fileName}>{st.file.name}</span>
                        <span style={bs.fileSize}>({(st.file.size / 1024).toFixed(0)} KB)</span>
                      </>
                    ) : st.mode === 'text' && st.text.length > 0 ? (
                      <>
                        <span style={bs.fileIcon}>✏️</span>
                        <span style={bs.fileName}>{st.text.length} chars pasted</span>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: '#e67e22' }}>⚠ No content yet</span>
                    )}
                  </div>

                  {/* Timestamp */}
                  <input type="datetime-local" value={st.timestamp}
                    onChange={e => updateStudent(i, 'timestamp', e.target.value)}
                    style={bs.timeInput} title="Submission time" />

                  {/* Remove */}
                  <button onClick={() => removeStudent(i)} style={bs.removeBtn} title="Remove">✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Add manual text student */}
          <button onClick={addManual} style={bs.addBtn}>
            + Add student with pasted text
          </button>

          {/* Inline text areas for text-mode students */}
          {students.some(s => s.mode === 'text') && (
            <div style={{ marginBottom: 12 }}>
              {students.map((st, i) => st.mode === 'text' ? (
                <div key={i} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>
                    {st.name} — paste text:
                  </div>
                  <textarea
                    placeholder="Paste essay here (min 30 chars)..."
                    value={st.text}
                    onChange={e => updateStudent(i, 'text', e.target.value)}
                    style={bs.textarea} rows={3}
                  />
                  <div style={bs.charCount}>
                    {st.text.length} chars
                    {st.text.length > 0 && st.text.length < 30 &&
                      <span style={{ color: '#e74c3c' }}> — too short</span>}
                  </div>
                </div>
              ) : null)}
            </div>
          )}

          {error && <div style={bs.error}>{error}</div>}

          <button onClick={submit} disabled={loading || readyCount < 2} style={{
            ...bs.submitBtn,
            opacity: readyCount < 2 ? 0.5 : 1,
            cursor: readyCount < 2 ? 'not-allowed' : 'pointer',
          }}>
            {loading
              ? '⏳ Processing files and comparing...'
              : readyCount < 2
                ? `Add at least 2 students to compare (${readyCount} ready)`
                : `▶ Compare ${readyCount} students`}
          </button>

          {result && <BatchResults result={result} />}
        </>
      )}
    </div>
  );
}


// ── Batch results: ownership + edit distance ──────────────────────────────────

const MOD_COLORS = {
  'Direct copy':      '#ef4444',
  'Minor edits':      '#f59e0b',
  'Moderate edits':   '#eab308',
  'Heavy edits':      '#8b5cf6',
  'Heavily modified': '#34d399',
  'exact':            '#ef4444',
  'paraphrase':       '#f59e0b',
};

function BatchResults({ result }) {
  const [openPair, setOpenPair] = useState(null);
  const pairs = result.pairs || [];

  if (!pairs.length) return (
    <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(52, 211, 153, 0.15)', border: '1px solid rgba(52, 211, 153, 0.3)', borderRadius: 8, color: '#86efac', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
      ✅ No significant similarity found. All submissions appear independent.
    </div>
  );

  return (
    <div style={{ marginTop: 16, border: '1px solid rgba(251, 191, 36, 0.2)', borderRadius: 12, overflow: 'hidden', background: 'rgba(30, 41, 59, 0.4)', backdropFilter: 'blur(8px)' }}>
      <div style={{ padding: '12px 16px', background: 'rgba(251, 191, 36, 0.08)', fontSize: 13, fontWeight: 600, color: '#fbbf24', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(251, 191, 36, 0.1)' }}>
        <span>⚠️ {pairs.length} suspicious pair{pairs.length !== 1 ? 's' : ''} found — graph updated below</span>
      </div>

      {pairs.map((pair, i) => (
        <div key={i} style={{ borderTop: '1px solid rgba(251, 191, 36, 0.05)' }}>
          {/* Pair header */}
          <div style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
            onClick={() => setOpenPair(openPair === i ? null : i)}>
            <div>
              {/* Direction indicator — framed as indicator not accusation */}
              {pair.is_common_source ? (
                // Common source case — neither student copied the other
                <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
                    📚 Possible common external source
                  </div>
                  <div style={{ fontSize: 12, color: '#78350f', lineHeight: 1.5 }}>
                    {pair.direction_signals?.corpus || 'Both submissions match a third-party source. Neither student may have copied the other.'}
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ background: '#eafaf1', color: '#1a7a40', padding: '3px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
                      👤 {pair.original}
                    </span>
                    {pair.submitted_a && pair.submitted_b && (
                      <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                        {new Date(pair.original === pair.student_a ? pair.submitted_a : pair.submitted_b)
                          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <span style={{ fontSize: 12, color: '#aaa', fontStyle: 'italic' }}>→ likely copied by →</span>
                    {pair.submitted_a && pair.submitted_b && (
                      <span style={{ fontSize: 11, color: '#888', fontFamily: 'monospace' }}>
                        {new Date(pair.copier === pair.student_a ? pair.submitted_a : pair.submitted_b)
                          .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <span style={{ background: '#fdecea', color: '#922b21', padding: '3px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
                      🔴 {pair.copier}
                    </span>
                    {pair.direction_confidence && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                        background: pair.direction_confidence === 'High' ? '#eafaf1' : pair.direction_confidence === 'Medium' ? '#fef3e2' : '#f5f5f5',
                        color:      pair.direction_confidence === 'High' ? '#1a7a40' : pair.direction_confidence === 'Medium' ? '#d35400' : '#888',
                      }}>
                        {pair.direction_confidence === 'High' ? '✓' : pair.direction_confidence === 'Medium' ? '~' : '?'} {pair.direction_confidence} confidence
                      </span>
                    )}
                  </div>

                  {/* 3-signal evidence pills */}
                  {pair.direction_signals && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                      {[
                        ['⏱', 'time',      pair.direction_signals.time],
                        ['✍️', 'ownership', pair.direction_signals.ownership],
                        ['📊', 'semantic',  pair.direction_signals.semantic],
                      ].filter(([,, v]) => v).map(([icon, key, val]) => (
                        <span key={key} style={{ fontSize: 11, color: '#555', background: '#f8f9fa', padding: '2px 8px', borderRadius: 6, border: '1px solid #e8e8e8', lineHeight: 1.5 }}>
                          {icon} {val}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Disclaimer — always shown */}
                  <div style={{ fontSize: 11, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px', marginTop: 4 }}>
                    ⚠️ Direction is an indicator only. Manual review required before any academic action.
                    {pair.direction_confidence === 'Low' && ' Signals were inconclusive — treat with caution.'}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <span style={{ background: '#eef3fb', color: '#1a56a0', padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                  {Math.round(pair.similarity * 100)}% similar
                </span>
                <span style={{ background: '#fef3e2', color: '#e67e22', padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                  {pair.flagged_sentences} sentences flagged
                </span>
              </div>
            </div>
            <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>{openPair === i ? '▲' : '▼ details'}</span>
          </div>

          {/* Sentence ownership + edit distance */}
          {openPair === i && pair.sentence_pairs?.length > 0 && (
            <div style={{ padding: '0 16px 16px', background: '#fafafa' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 0 10px' }}>
                Sentence breakdown — ownership & modification level
              </div>
              {pair.sentence_pairs.map((sp, j) => {
                const col = MOD_COLORS[sp.modification] || '#888';
                return (
                  <div key={j} style={{ border: '1px solid #e8e8e8', borderRadius: 8, padding: 12, marginBottom: 10, background: '#fff' }}>
                    {/* Modification badge + edit bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ background: col + '22', color: col, border: `1px solid ${col}44`, padding: '3px 10px', borderRadius: 10, fontSize: 12, fontWeight: 700 }}>
                        {sp.modification}
                      </span>
                      <span style={{ fontSize: 12, color: '#888' }}>{sp.edit_pct}% words changed</span>
                      <div style={{ flex: 1, minWidth: 80, height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${sp.edit_pct}%`, height: '100%', background: col, borderRadius: 3, transition: 'width 0.4s' }} />
                      </div>
                    </div>
                    {/* Side by side */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'start' }}>
                      <div style={{ background: '#eafaf1', borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#1a7a40', marginBottom: 4 }}>
                          👤 {sp.owner} (original)
                        </div>
                        <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{sp.sentence_a}</div>
                      </div>
                      <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, alignSelf: 'center', padding: '0 4px' }}>vs</div>
                      <div style={{ background: '#fdecea', borderRadius: 6, padding: '8px 10px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#922b21', marginBottom: 4 }}>
                          🔴 {pair.copier} ({sp.similarity >= 0.95 ? 'exact copy' : `${Math.round(sp.similarity * 100)}% match`})
                        </div>
                        <div style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{sp.sentence_b}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Collaboration rings */}
      {result.clustering?.rings?.length > 0 && (
        <div style={{ padding: '12px 16px', background: '#fef3e2', borderTop: '1px solid #f0d9b0' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#7b4f00', marginBottom: 8 }}>🔗 Collaboration rings detected:</div>
          {result.clustering.rings.map((ring, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: '#fff', borderRadius: 6, marginBottom: 6, borderLeft: `4px solid ${ring.risk === 'HIGH' ? '#e74c3c' : ring.risk === 'MEDIUM' ? '#e67e22' : '#f39c12'}`, flexWrap: 'wrap' }}>
              <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: ring.risk === 'HIGH' ? '#fdecea' : ring.risk === 'MEDIUM' ? '#fef3e2' : '#fef9e7', color: ring.risk === 'HIGH' ? '#c0392b' : ring.risk === 'MEDIUM' ? '#e67e22' : '#f39c12' }}>
                {ring.risk}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#333', flex: 1 }}>{ring.students.join(' · ')}</span>
              <span style={{ fontSize: 12, color: '#888' }}>{ring.student_count} students</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ── Main NetworkGraph ─────────────────────────────────────────────────────────

export default function NetworkGraph({ threshold = 0.70 }) {
  const svgRef           = useRef(null);
  const [pairs,          setPairs]          = useState([]);
  const [rings,          setRings]          = useState([]);
  const [nodeClusterMap, setNodeClusterMap] = useState({});
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);
  const [tooltip,        setTooltip]        = useState(null);
  const [refreshKey,     setRefreshKey]     = useState(0);  // increment to refresh graph

  // Fetch pairs from MongoDB
  useEffect(() => {
    setLoading(true);
    fetch(`${API}/pairs?threshold=${threshold}`)
      .then(r => r.json())
      .then(data => { setPairs(data.pairs || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [threshold, refreshKey]);

  useEffect(() => {
    if (!pairs.length) return;
    const students   = [...new Set(pairs.flatMap(p => [p.student_a, p.student_b]))];
    const clusterMap = clusterFromPairs(pairs, students, threshold);
    setNodeClusterMap(clusterMap.nodeMap);
    setRings(clusterMap.rings);
  }, [pairs, threshold]);

  useEffect(() => {
    if (!pairs.length || !svgRef.current) return;

    const flaggedCount = {};
    pairs.forEach(p => {
      flaggedCount[p.student_a] = (flaggedCount[p.student_a] || 0) + p.flagged_sentences;
      flaggedCount[p.student_b] = (flaggedCount[p.student_b] || 0) + p.flagged_sentences;
    });

    const nameSet = new Set();
    pairs.forEach(p => { nameSet.add(p.student_a); nameSet.add(p.student_b); });
    const nodes = Array.from(nameSet).map(id => ({
      id, flagged: flaggedCount[id] || 0, clusterId: nodeClusterMap[id] ?? -1,
    }));

    const links = pairs.map(p => ({
      source:     p.student_a,
      target:     p.student_b,
      similarity: p.similarity,
      flagged:    p.flagged_sentences,
      copier:     p.copier   || p.student_b,
      original:   p.original || p.student_a,
    }));

    const maxFlagged = Math.max(...nodes.map(n => n.flagged), 1);
    const nodeRadius = d3.scaleLinear().domain([0, maxFlagged]).range([14, 36]).clamp(true);
    const edgeColor  = d3.scaleLinear().domain([0.70, 0.85, 1.0]).range(['#27ae60', '#e67e22', '#e74c3c']);
    const edgeWidth  = d3.scaleLinear().domain([0.70, 1.0]).range([1.5, 7]).clamp(true);

    const W = 780, H = 500;
    const svg = d3.select(svgRef.current).attr('width', W).attr('height', H);
    svg.selectAll('*').remove();

    svg.append('defs').append('marker')
      .attr('id', 'arrowhead').attr('viewBox', '0 0 10 10')
      .attr('refX', 9).attr('refY', 5)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto-start-reverse')
      .append('path').attr('d', 'M2 2L8 5L2 8')
      .attr('fill', 'none').attr('stroke', '#888')
      .attr('stroke-width', 1.5).attr('stroke-linecap', 'round');

    const hullGroup = svg.append('g').attr('class', 'hulls');

    const simulation = d3.forceSimulation(nodes)
      .force('link',    d3.forceLink(links).id(d => d.id).distance(160))
      .force('charge',  d3.forceManyBody().strength(-450))
      .force('center',  d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide(d => nodeRadius(d.flagged) + 14));

    const link = svg.append('g')
      .selectAll('path').data(links).join('path')
      .attr('fill', 'none')
      .attr('stroke', d => edgeColor(d.similarity))
      .attr('stroke-width', d => edgeWidth(d.similarity))
      .attr('stroke-opacity', 0.75).attr('stroke-linecap', 'round')
      .attr('marker-end', 'url(#arrowhead)').style('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        d3.select(this).attr('stroke-opacity', 1).attr('stroke-width', edgeWidth(d.similarity) + 2);
        const rect = svgRef.current.getBoundingClientRect();
        setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top,
          studentA: d.source.id || d.source, studentB: d.target.id || d.target,
          similarity: d.similarity, flagged: d.flagged, copier: d.copier, original: d.original });
      })
      .on('mousemove', function(event) {
        const rect = svgRef.current.getBoundingClientRect();
        setTooltip(t => t ? { ...t, x: event.clientX - rect.left, y: event.clientY - rect.top } : t);
      })
      .on('mouseleave', function(event, d) {
        d3.select(this).attr('stroke-opacity', 0.75).attr('stroke-width', edgeWidth(d.similarity));
        setTooltip(null);
      });

    const linkLabel = svg.append('g')
      .selectAll('text').data(links.filter(d => d.similarity > 0.80)).join('text')
      .attr('font-size', 11).attr('font-weight', '600')
      .attr('fill', d => edgeColor(d.similarity))
      .attr('text-anchor', 'middle').attr('pointer-events', 'none')
      .text(d => `${Math.round(d.similarity * 100)}%`);

    const node = svg.append('g')
      .selectAll('g').data(nodes).join('g')
      .style('cursor', 'grab')
      .call(dragBehaviour(simulation));

    node.append('circle')
      .attr('r', d => nodeRadius(d.flagged) + 7)
      .attr('fill', d => clusterColor(d.clusterId))
      .attr('fill-opacity', d => d.clusterId === -1 ? 0 : 0.18)
      .attr('stroke', d => d.clusterId === -1 ? 'none' : clusterColor(d.clusterId))
      .attr('stroke-width', d => d.clusterId === -1 ? 0 : 1.5)
      .attr('stroke-opacity', 0.4);

    node.append('circle')
      .attr('r', d => nodeRadius(d.flagged))
      .attr('fill', d => clusterColor(d.clusterId))
      .attr('stroke', '#fff').attr('stroke-width', 2.5);

    node.filter(d => d.flagged > 0).append('text')
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('font-size', d => nodeRadius(d.flagged) > 22 ? 13 : 10)
      .attr('font-weight', '700').attr('fill', '#fff').attr('pointer-events', 'none')
      .text(d => d.flagged);

    node.append('text')
      .attr('text-anchor', 'middle').attr('font-size', 13).attr('font-weight', '600')
      .attr('fill', '#2c3e50').attr('pointer-events', 'none')
      .attr('dy', d => nodeRadius(d.flagged) + 16).text(d => d.id);

    node.filter(d => d.clusterId !== -1).append('text')
      .attr('text-anchor', 'middle').attr('font-size', 10).attr('font-weight', '600')
      .attr('fill', d => clusterColor(d.clusterId)).attr('pointer-events', 'none')
      .attr('dy', d => nodeRadius(d.flagged) + 30)
      .text(d => `Ring ${d.clusterId + 1}`);

    simulation.on('tick', () => {
      nodes.forEach(d => {
        const r = nodeRadius(d.flagged);
        d.x = Math.max(r + 20, Math.min(W - r - 20, d.x));
        d.y = Math.max(r + 20, Math.min(H - r - 36, d.y));
      });
      link.attr('d', d => {
        const isCopierSource = d.copier === (d.source.id || d.source);
        const sx = isCopierSource ? d.source.x : d.target.x;
        const sy = isCopierSource ? d.source.y : d.target.y;
        const tx = isCopierSource ? d.target.x : d.source.x;
        const ty = isCopierSource ? d.target.y : d.source.y;
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const endR = nodeRadius(isCopierSource ? d.target.flagged : d.source.flagged);
        const ex = tx - (dx / dist) * (endR + 8);
        const ey = ty - (dy / dist) * (endR + 8);
        const mx = (sx + ex) / 2 - (dy / dist) * 24;
        const my = (sy + ey) / 2 + (dx / dist) * 24;
        return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
      });
      linkLabel
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2 - 8);
      node.attr('transform', d => `translate(${d.x},${d.y})`);
      drawHulls(hullGroup, nodes, nodeRadius);
    });

    return () => simulation.stop();
  }, [pairs, nodeClusterMap]);

  function dragBehaviour(simulation) {
    return d3.drag()
      .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y; setTooltip(null); })
      .on('end',   (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; });
  }

  return (
    <div>
      {/* Batch upload panel — always shown above graph */}
      <BatchUploadPanel onDone={() => setRefreshKey(k => k + 1)} />

      {/* Graph card */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 2px 16px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h3 style={{ margin: 0, color: '#1a1a2e', fontSize: 18 }}>Student Similarity Network</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setRefreshKey(k => k + 1)}
              style={{ border: '1px solid #ddd', background: '#f5f5f5', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#555' }}>
              ↻ Refresh
            </button>
            <button onClick={async () => {
              if (!window.confirm('Clear all stored pairs? This resets the graph.')) return;
              await fetch(`${API}/pairs`, { method: 'DELETE' });
              setPairs([]); setRings([]); setNodeClusterMap({});
            }} style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#dc2626' }}>
              🗑 Clear pairs
            </button>
          </div>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#888' }}>
          Node size = flagged sentences · Colour = collaboration ring · Arrow = copier → original · Hover edge for details
        </p>

        {loading && <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading network graph...</div>}
        {error   && <div style={{ padding: 20, color: '#e74c3c' }}>⚠ {error}</div>}

        {!loading && !error && !pairs.length && (
          <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 14 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🕸</div>
            No pairs found above {Math.round(threshold * 100)}% threshold.
            <div style={{ marginTop: 8, fontSize: 13 }}>Submit students above to populate the graph.</div>
          </div>
        )}

        {!loading && !error && pairs.length > 0 && (
          <>
            {/* Collaboration rings */}
            {rings.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {rings.map(ring => (
                  <div key={ring.clusterId} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '10px 14px', borderRadius: 10, marginBottom: 8,
                    background: ring.risk === 'HIGH' ? '#fde8e8' : ring.risk === 'MEDIUM' ? '#fef3e2' : '#eafaf1',
                    border: `1px solid ${ring.risk === 'HIGH' ? '#e74c3c' : ring.risk === 'MEDIUM' ? '#f39c12' : '#27ae60'}`,
                  }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', flexShrink: 0, marginTop: 3, background: clusterColor(ring.clusterId) }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: ring.risk === 'HIGH' ? '#c0392b' : ring.risk === 'MEDIUM' ? '#d35400' : '#1e8449' }}>
                        {ring.risk === 'HIGH' ? '🔴' : ring.risk === 'MEDIUM' ? '🟠' : '🟡'} Ring {ring.clusterId + 1} — {ring.risk} RISK · {ring.students.length} students
                      </div>
                      <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>
                        <strong>Students:</strong> {ring.students.join(' · ')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Legend */}
            <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
              {[['#27ae60','70–85% similar'],['#e67e22','85–92% similar'],['#e74c3c','92–100% similar']].map(([color, label]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
                  <div style={{ width: 28, height: 4, borderRadius: 2, background: color }} />{label}
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#555' }}>
                → Arrow = copier points to original
              </div>
            </div>

            {/* SVG graph */}
            <div style={{ position: 'relative', border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
              <svg ref={svgRef} style={{ display: 'block', background: '#fafafa' }} />
              {tooltip && (
                <div style={{
                  position: 'absolute', left: tooltip.x + 14, top: tooltip.y,
                  background: '#1a1a2e', color: '#fff', borderRadius: 10,
                  padding: '10px 14px', fontSize: 13, lineHeight: 1.7,
                  pointerEvents: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
                  zIndex: 10, minWidth: 180, transform: 'translateY(-50%)',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>{tooltip.studentA} ↔ {tooltip.studentB}</div>
                  <div><span style={{ color: '#9DC3E6' }}>Similarity: </span>
                    <span style={{ color: similarityColor(tooltip.similarity), fontWeight: 600 }}>{Math.round(tooltip.similarity * 100)}%</span></div>
                  <div><span style={{ color: '#9DC3E6' }}>Flagged: </span><span style={{ fontWeight: 600 }}>{tooltip.flagged} sentences</span></div>
                  {tooltip.copier && tooltip.original && (
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px solid #2c4a6e' }}>
                      <span style={{ color: '#9DC3E6' }}>Copied: </span>
                      <span style={{ fontWeight: 600 }}>{tooltip.copier}</span>
                      <span style={{ color: '#9DC3E6' }}> → </span>
                      <span style={{ fontWeight: 600 }}>{tooltip.original}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function drawHulls(hullGroup, nodes, nodeRadius) {
  hullGroup.selectAll('path').remove();
  const byCluster = {};
  nodes.forEach(n => {
    if (n.clusterId === -1 || n.x === undefined) return;
    if (!byCluster[n.clusterId]) byCluster[n.clusterId] = [];
    byCluster[n.clusterId].push(n);
  });
  Object.entries(byCluster).forEach(([cid, clusterNodes]) => {
    if (clusterNodes.length < 2) return;
    const points = [];
    clusterNodes.forEach(n => {
      const r = nodeRadius(n.flagged) + 20;
      for (let a = 0; a < 2 * Math.PI; a += Math.PI / 6)
        points.push([n.x + r * Math.cos(a), n.y + r * Math.sin(a)]);
    });
    const hull = d3.polygonHull(points);
    if (!hull) return;
    const color = clusterColor(parseInt(cid));
    hullGroup.append('path')
      .attr('d', `M${hull.join('L')}Z`)
      .attr('fill', color).attr('fill-opacity', 0.07)
      .attr('stroke', color).attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.3).attr('stroke-dasharray', '6 4')
      .attr('stroke-linejoin', 'round');
  });
}

function clusterFromPairs(pairs, students, threshold) {
  const parent = {};
  students.forEach(s => { parent[s] = s; });
  function find(x) { if (parent[x] !== x) parent[x] = find(parent[x]); return parent[x]; }
  function union(x, y) { parent[find(x)] = find(y); }
  pairs.forEach(p => { if (p.similarity >= threshold) union(p.student_a, p.student_b); });
  const rootToId = {}, nodeMap = {};
  let nextId = 0;
  students.forEach(s => {
    const root = find(s);
    if (!(root in rootToId)) rootToId[root] = nextId++;
    nodeMap[s] = rootToId[root];
  });
  const ringMap = {};
  students.forEach(s => { const cid = nodeMap[s]; if (!ringMap[cid]) ringMap[cid] = []; ringMap[cid].push(s); });
  const rings = Object.entries(ringMap)
    .filter(([, m]) => m.length >= 2)
    .map(([cid, members]) => ({
      clusterId: parseInt(cid), students: members,
      risk: members.length >= 4 ? 'HIGH' : members.length === 3 ? 'MEDIUM' : 'LOW',
    }));
  rings.sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.risk] - { HIGH: 0, MEDIUM: 1, LOW: 2 }[b.risk] || b.students.length - a.students.length));
  Object.keys(nodeMap).forEach(s => { const cid = nodeMap[s]; if (!rings.find(r => r.clusterId === cid)) nodeMap[s] = -1; });
  return { nodeMap, rings };
}

function similarityColor(s) {
  if (s >= 0.92) return '#e74c3c';
  if (s >= 0.85) return '#e67e22';
  return '#27ae60';
}

// ── BatchUploadPanel styles ───────────────────────────────────────────────────

const bs = {
  // card shell — glassmorphic
  wrap:          { background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(12px)', border: '1px solid rgba(251, 191, 36, 0.1)', borderRadius: 16, padding: 20, boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)', marginBottom: 20, transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' },
  head:          { display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginBottom: 16, flexWrap: 'wrap', transition: 'opacity 0.2s' },
  headTitle:     { fontSize: 16, fontWeight: 700, color: '#fbbf24', fontFamily: 'Syne, sans-serif' },
  headSub:       { fontSize: 13, color: '#cbd5e1', fontFamily: 'Inter, sans-serif' },
  // threshold
  threshRow:     { display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(251, 191, 36, 0.05)', backdropFilter: 'blur(8px)', border: '1px solid rgba(251, 191, 36, 0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, transition: 'all 0.2s' },
  threshLabel:   { fontSize: 13, color: '#e2e8f0', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' },
  threshHint:    { fontSize: 11, color: '#94a3b8', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' },
  // drop zone
  dropZone:      { border: '2px dashed #fbbf24', borderRadius: 12, padding: '28px 20px', textAlign: 'center', background: 'rgba(251, 191, 36, 0.05)', marginBottom: 16, transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', cursor: 'grab' },
  dropZoneActive:{ border: '2px solid #fbbf24', background: 'rgba(251, 191, 36, 0.12)', transform: 'scale(1.02)', boxShadow: '0 0 20px rgba(251, 191, 36, 0.2)' },
  browseBtn:     { display: 'inline-block', padding: '10px 24px', background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: '#0a0e1a', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', fontFamily: 'Inter, sans-serif', transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(251, 191, 36, 0.3)' },
  // student list
  studentList:   { border: '1px solid rgba(251, 191, 36, 0.15)', borderRadius: 10, overflow: 'hidden', marginBottom: 12, background: 'rgba(30, 41, 59, 0.4)', backdropFilter: 'blur(8px)' },
  listHeader:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: 'rgba(251, 191, 36, 0.08)', borderBottom: '1px solid rgba(251, 191, 36, 0.1)' },
  studentRow:    { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(251, 191, 36, 0.05)', flexWrap: 'wrap', transition: 'background 0.2s' },
  indexBadge:    { width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: '#0a0e1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, fontFamily: 'Syne, sans-serif' },
  nameTag:       { padding: '4px 12px', background: 'rgba(251, 191, 36, 0.1)', color: '#fbbf24', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(251, 191, 36, 0.25)', whiteSpace: 'nowrap', transition: 'all 0.2s', fontFamily: 'Inter, sans-serif' },
  nameEditInput: { padding: '4px 8px', borderRadius: 6, border: '2px solid #fbbf24', fontSize: 13, fontWeight: 600, width: 90, color: '#fbbf24', background: 'rgba(15, 23, 42, 0.8)', outline: 'none', fontFamily: 'Inter, sans-serif' },
  fileInfo:      { flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  fileIcon:      { fontSize: 14, flexShrink: 0 },
  fileName:      { fontSize: 13, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'Inter, sans-serif' },
  fileSize:      { fontSize: 11, color: '#64748b', flexShrink: 0, fontFamily: 'Inter, sans-serif' },
  timeInput:     { padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(251, 191, 36, 0.2)', fontSize: 12, color: '#cbd5e1', background: 'rgba(15, 23, 42, 0.6)', flexShrink: 0, fontFamily: 'Inter, sans-serif' },
  removeBtn:     { border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', fontSize: 16, flexShrink: 0, padding: '0 4px', transition: 'color 0.2s' },
  // manual add + text areas
  addBtn:        { width: '100%', border: '1px dashed #fbbf24', background: 'transparent', color: '#fbbf24', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, marginBottom: 12, transition: 'all 0.2s', fontFamily: 'Inter, sans-serif' },
  textarea:      { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(251, 191, 36, 0.2)', fontSize: 13, fontFamily: 'Inter, sans-serif', resize: 'vertical', boxSizing: 'border-box', background: 'rgba(15, 23, 42, 0.6)', color: '#e2e8f0' },
  charCount:     { fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 2, fontFamily: 'Inter, sans-serif' },
  // error + submit
  error:         { background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 10, fontFamily: 'Inter, sans-serif' },
  submitBtn:     { width: '100%', padding: 12, borderRadius: 8, background: 'linear-gradient(135deg, #fbbf24, #f59e0b)', color: '#0a0e1a', border: 'none', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.3s', boxShadow: '0 4px 12px rgba(251, 191, 36, 0.4)' },
};
