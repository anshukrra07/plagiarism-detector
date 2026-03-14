// ScoreSummary.jsx — improved with modern UI
export default function ScoreSummary({ result }) {
  const risk = {
    HIGH_RISK:   { color:"#ef4444", glow:"rgba(239,68,68,0.3)", bg:"rgba(239,68,68,0.08)", label:"HIGH RISK", icon:"🚩" },
    MEDIUM_RISK: { color:"#f59e0b", glow:"rgba(245,158,11,0.3)", bg:"rgba(245,158,11,0.08)", label:"MEDIUM RISK", icon:"⚠️" },
    LOW_RISK:    { color:"#fb923c", glow:"rgba(251,146,60,0.3)", bg:"rgba(251,146,60,0.08)", label:"LOW RISK", icon:"✓" },
    CLEAN:       { color:"#34d399", glow:"rgba(52,211,153,0.3)", bg:"rgba(52,211,153,0.08)", label:"CLEAN", icon:"✅" },
  };
  const r        = risk[result.label] || risk.CLEAN;
  const coverage = result.corpus_coverage ?? null;
  const confColor = { High:"#ef4444", Medium:"#f59e0b", Low:"#34d399" }[result.confidence] || "#6b7280";

  return (
    <div style={{
      background: "rgba(17,24,39,0.6)",
      border: `1px solid ${r.color}30`,
      borderRadius: 18,
      marginBottom: 16,
      overflow: "hidden",
      boxShadow: `0 8px 32px ${r.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      backdropFilter: "blur(10px)",
      transition: "all 0.3s ease"
    }}>
      {/* Score + label row */}
      <div style={{ padding:"28px 24px 20px", display:"flex", gap:20, alignItems:"center" }}>
        {/* Animated SVG dial */}
        <svg width="110" height="110" viewBox="0 0 96 96" style={{ flexShrink:0 }}>
          {/* Background circle */}
          <circle cx="48" cy="48" r="40" fill="none" stroke="rgba(31,41,55,0.4)" strokeWidth="6" />
          {/* Progress circle */}
          <circle
            cx="48"
            cy="48"
            r="40"
            fill="none"
            stroke={r.color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2*Math.PI*40*result.overall_score/100} ${2*Math.PI*40}`}
            transform="rotate(-90 48 48)"
            style={{
              filter:`drop-shadow(0 0 8px ${r.color})`,
              transition:"stroke-dasharray 1s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          />
          {/* Score text */}
          <text x="48" y="44" textAnchor="middle" fontFamily="'Syne',sans-serif" fontWeight="800" fontSize="20" fill={r.color}>
            {result.overall_score}%
          </text>
          <text x="48" y="60" textAnchor="middle" fontFamily="'Inter',sans-serif" fontSize="9" fill="#6b7280" fontWeight="500" letterSpacing="1">
            SCORE
          </text>
        </svg>

        <div style={{ flex:1 }}>
          {/* Risk label with icon */}
          <div style={{
            display:"inline-flex",
            alignItems:"center",
            gap:8,
            background: r.bg,
            border:`1px solid ${r.color}40`,
            borderRadius:10,
            padding:"8px 14px",
            marginBottom:14,
          }}>
            <span style={{ fontSize: 16 }}>{r.icon}</span>
            <span style={{
              fontFamily:"'Inter',sans-serif",
              fontWeight:700,
              fontSize:12,
              color:r.color,
              letterSpacing:"0.05em"
            }}>
              {r.label}
            </span>
          </div>

          {/* Stats grid */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"14px 18px" }}>
            <Stat label="Flagged" value={`${result.flagged_count}`} sub={`of ${result.total_sentences}`} color={r.color} />
            <Stat label="Confidence" value={result.confidence} color={confColor} />
          </div>
        </div>
      </div>

      {/* Coverage bar */}
      {coverage !== null && (
        <div style={{
          padding:"16px 24px",
          borderTop: "1px solid rgba(31,41,55,0.5)",
          background: "rgba(10,14,26,0.3)"
        }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
            <span style={{
              fontFamily:"'Inter',sans-serif",
              fontSize:12,
              fontWeight:600,
              color:"#9ca3af"
            }}>
              📚 Corpus Coverage
            </span>
            <span style={{
              fontFamily:"'Inter',sans-serif",
              fontSize:13,
              color: coverage<30?"#ef4444":coverage<60?"#f59e0b":"#34d399",
              fontWeight:700
            }}>
              {coverage}%
            </span>
          </div>
          <div style={{
            height:6,
            background:"rgba(31,41,55,0.6)",
            borderRadius:3,
            overflow:"hidden",
            marginBottom:8,
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3)"
          }}>
            <div style={{
              height:"100%",
              borderRadius:3,
              width:`${coverage}%`,
              background: coverage<30
                ? "linear-gradient(90deg, #ef4444, #dc2626)"
                : coverage<60
                ? "linear-gradient(90deg, #f59e0b, #d97706)"
                : "linear-gradient(90deg, #34d399, #10b981)",
              boxShadow: coverage<30
                ? "0 0 12px rgba(239,68,68,0.5)"
                : coverage<60
                ? "0 0 12px rgba(245,158,11,0.5)"
                : "0 0 12px rgba(52,211,153,0.5)",
              transition:"width 1s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }} />
          </div>
          <div style={{
            fontFamily:"'Inter',sans-serif",
            fontSize:11,
            color:"#9ca3af",
            lineHeight: 1.5
          }}>
            {coverage<40
              ? "⚠️ Low coverage — consider adding more corpus sources for better accuracy"
              : coverage<70
              ? "📊 Moderate coverage — results are reasonably reliable"
              : "✅ Good coverage — results have high confidence"}
          </div>
        </div>
      )}

      {/* CLEAN but flagged warning */}
      {result.label==="CLEAN" && result.flagged_count>0 && (
        <div style={{
          borderTop:"1px solid rgba(31,41,55,0.5)",
          padding:"12px 24px",
          background:"rgba(251,191,36,0.08)",
          fontFamily:"'Inter',sans-serif",
          fontSize:12,
          color:"#fbbf24",
          display: "flex",
          alignItems: "center",
          gap: 8
        }}>
          <span style={{ fontSize: 16 }}>ℹ️</span>
          <span>{result.flagged_count} sentence{result.flagged_count!==1?"s":""} flagged — review corpus sources for better accuracy</span>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div>
      <div style={{
        fontFamily:"'Inter',sans-serif",
        fontSize:11,
        color:"#6b7280",
        fontWeight:600,
        marginBottom:4,
        letterSpacing: "0.02em"
      }}>
        {label}
      </div>
      <div style={{
        fontFamily:"'Syne',sans-serif",
        fontWeight:800,
        fontSize:20,
        color,
        lineHeight:1.2
      }}>
        {value}
        {sub && <span style={{
          fontFamily:"'Inter',sans-serif",
          fontSize:11,
          fontWeight:500,
          color:"#6b7280",
          marginLeft:4
        }}>{sub}</span>}
      </div>
    </div>
  );
}