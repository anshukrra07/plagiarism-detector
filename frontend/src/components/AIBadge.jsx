// AIBadge.jsx — improved with modern UI
export default function AIBadge({ aiDetection }) {
  if (!aiDetection || !aiDetection.label) return null;

  const { ai_score, ai_percent, human_score, label, confidence, explanation } = aiDetection;

  const cfg = {
    AI_GENERATED: {
      color:"#ef4444",
      bg:"rgba(239,68,68,0.08)",
      border:"#ef4444",
      icon:"🤖",
      text:"AI Generated",
      glow:"rgba(239,68,68,0.3)"
    },
    LIKELY_AI: {
      color:"#f59e0b",
      bg:"rgba(245,158,11,0.08)",
      border:"#f59e0b",
      icon:"⚠️",
      text:"Likely AI",
      glow:"rgba(245,158,11,0.3)"
    },
    UNCERTAIN: {
      color:"#9ca3af",
      bg:"rgba(156,163,175,0.08)",
      border:"#9ca3af",
      icon:"❓",
      text:"Uncertain",
      glow:"rgba(156,163,175,0.2)"
    },
    LIKELY_HUMAN: {
      color:"#34d399",
      bg:"rgba(52,211,153,0.08)",
      border:"#34d399",
      icon:"✅",
      text:"Likely Human",
      glow:"rgba(52,211,153,0.3)"
    },
    HUMAN: {
      color:"#34d399",
      bg:"rgba(52,211,153,0.08)",
      border:"#34d399",
      icon:"✅",
      text:"Human Written",
      glow:"rgba(52,211,153,0.3)"
    },
  }[label] || { color:"#9ca3af",bg:"rgba(156,163,175,0.08)",border:"#9ca3af",icon:"❓",text:"Unknown",glow:"rgba(156,163,175,0.2)" };

  const aiPct    = ai_percent    ?? Math.round((ai_score    ?? 0) * 100);
  const humanPct = Math.round((human_score ?? (1-(ai_score??0))) * 100);

  return (
    <div style={{
      background: cfg.bg,
      border:`1px solid ${cfg.border}40`,
      borderRadius: 16,
      padding: "20px",
      marginBottom: 16,
      boxShadow: `0 8px 24px ${cfg.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      backdropFilter: "blur(10px)",
      transition: "all 0.3s ease"
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 14
      }}>
        <span style={{ fontSize: 24 }}>{cfg.icon}</span>
        <div>
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.05em",
            color: cfg.color
          }}>
            {cfg.text}
          </div>
          <div style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            color: "#9ca3af",
            marginTop: 2
          }}>
            AI Detection • Confidence: <strong>{confidence}</strong>
          </div>
        </div>
      </div>

      {/* Score bars */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
        marginBottom: 14
      }}>
        {[
          { icon:"🤖", label:"AI",    pct:aiPct,    color:cfg.color },
          { icon:"👤", label:"Human", pct:humanPct, color:"#34d399" },
        ].map(b => (
          <div key={b.label}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6
            }}>
              <span style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                color: "#9ca3af",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 6
              }}>
                <span style={{ fontSize: 14 }}>{b.icon}</span>
                {b.label}
              </span>
              <span style={{
                fontFamily: "'Inter', sans-serif",
                fontWeight: 700,
                fontSize: 12,
                color: b.color,
              }}>
                {b.pct}%
              </span>
            </div>
            <div style={{
              height: 6,
              background: "rgba(31,41,55,0.6)",
              borderRadius: 3,
              overflow: "hidden",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.3)"
            }}>
              <div style={{
                height: "100%",
                borderRadius: 3,
                width: `${b.pct}%`,
                background: `linear-gradient(90deg, ${b.color}, ${b.color}dd)`,
                boxShadow: `0 0 10px ${b.color}40`,
                transition: "width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* Explanation */}
      <div style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: "1px solid rgba(31,41,55,0.5)"
      }}>
        <p style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          color: "#9ca3af",
          lineHeight: 1.6,
          margin: 0,
          marginBottom: 8
        }}>
          {explanation}
        </p>
        <div style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 10,
          color: "#6b7280",
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>
          <span>·</span>
          <span>Powered by RoBERTa-based detection</span>
        </div>
      </div>
    </div>
  );
}