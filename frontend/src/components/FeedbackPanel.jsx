// FeedbackPanel.jsx — redesigned dark academic
import { useState } from 'react';

const API = 'http://localhost:8000';

export default function FeedbackPanel({ sentence, submissionId, onReplaceSentence }) {
  const [feedback,      setFeedback]      = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [replaced,      setReplaced]      = useState(null);
  const [downloadError, setDownloadError] = useState('');

  async function loadFeedback() {
    if (feedback) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/feedback/sentence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence:    sentence.sentence,
          label:       sentence.label,
          score:       sentence.score,
          source_url:  sentence.source_url    || 'unknown',
          confidence:  sentence.confidence    || 'Medium',
          matched_src: sentence.matched_source || '',
        }),
      });
      setFeedback(await res.json());
    } catch (e) { setFeedback({ error: e.message }); }
    finally     { setLoading(false); }
  }

  function handleReplaceSentence(text, key) {
    if (onReplaceSentence) {
      onReplaceSentence(text);
      setReplaced(key);
      setTimeout(() => setReplaced(null), 2000);
    }
  }

  async function downloadReport() {
    if (!submissionId) return;
    setDownloadError('');
    try {
      const res = await fetch(`${API}/report/${submissionId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `report_${submissionId.slice(-8)}.pdf`;
      a.click(); URL.revokeObjectURL(url);
    } catch(e) { setDownloadError(e.message); }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1f2937" }}>
      {!feedback && !loading && (
        <button onClick={loadFeedback} style={{
          fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 11,
          padding: "7px 14px", borderRadius: 7, border: "1px solid #1d4ed8",
          background: "#1e3a5f", color: "#60a5fa", cursor: "pointer",
          letterSpacing: "0.04em", marginBottom: 8,
        }}>
          💡 Get rewrite suggestions
        </button>
      )}

      {loading && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
          Generating suggestions…
        </div>
      )}

      {feedback?.error && (
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#ef4444" }}>⚠ {feedback.error}</div>
      )}

      {feedback && !feedback.error && (
        <div>
          <div style={{
            background: "#1a1200", border: "1px solid #78350f",
            borderRadius: 8, padding: "10px 14px", marginBottom: 12,
            fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#fde68a", lineHeight: 1.6,
          }}>
            <strong style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Why flagged:
            </strong>
            <br />
            {feedback.flag_reason}
          </div>

          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            ✏️ Suggested rewrites
          </div>

          {[
            { key: "citation", label: "Option A — Add citation", text: feedback.rewrite_citation, color: "#1e3a5f", border: "#1d4ed8", textColor: "#60a5fa" },
            { key: "rephrase", label: "Option B — Rephrase",    text: feedback.rewrite_rephrase,  color: "#052e16", border: "#064e3b", textColor: "#34d399" },
          ].map(opt => (
            <div key={opt.key} style={{
              background: opt.color, border: `1px solid ${opt.border}`,
              borderRadius: 8, padding: "10px 14px", marginBottom: 8,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: opt.textColor, fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>
                    {opt.label}
                  </div>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#d1d5db", lineHeight: 1.6 }}>
                    {opt.text}
                  </div>
                </div>
                <button onClick={() => handleReplaceSentence(opt.text, opt.key)} style={{
                  flexShrink: 0, padding: "6px 12px", borderRadius: 6, border: `1px solid ${opt.border}`,
                  fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 600,
                  background: replaced === opt.key ? "#064e3b" : "transparent",
                  color: replaced === opt.key ? "#34d399" : opt.textColor, cursor: "pointer",
                  transition: "all 0.3s ease",
                }}>
                  {replaced === opt.key ? "✓ Replaced" : "Replace"}
                </button>
              </div>
            </div>
          ))}

          <div style={{
            background: "#0a0e1a", border: "1px solid #1f2937",
            borderRadius: 8, padding: "10px 14px",
            fontFamily: "'Inter', sans-serif", fontSize: 12, color: "#9ca3af", lineHeight: 1.6,
          }}>
            <strong style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280" }}>
              💡 Tip:
            </strong>
            <br />
            {feedback.tip}
          </div>
        </div>
      )}

      {submissionId && (
        <div style={{ marginTop: 12 }}>
          <button onClick={downloadReport} style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600,
            padding: "7px 14px", borderRadius: 7, border: "1px solid #374151",
            background: "#1f2937", color: "#9ca3af", cursor: "pointer",
          }}>
            ⬇ Download PDF Report
          </button>
          {downloadError && (
            <div style={{ marginTop: 6, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#ef4444" }}>
              ⚠ {downloadError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}