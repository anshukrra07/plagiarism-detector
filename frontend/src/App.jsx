// App.jsx — full-width two-column layout
// Checker: sidebar (score+AI+sources+heatmap) | main (ResultsView)
// Network: full 1400px
// Stats: 4-col grid + full-width table

import { useState, useEffect, useRef, useCallback } from "react";
import UploadForm        from "./components/UploadForm";
import ScoreSummary      from "./components/ScoreSummary";
import SectionHeatmap    from "./components/SectionHeatmap";
import NetworkGraph      from "./components/NetworkGraph";
import AIBadge           from "./components/AIBadge";
import ResultsView       from "./components/ResultsView";
import SourceFetchStatus from "./components/SourceFetchStatus";
import { getStats }      from "./api";

const globalStyle = document.createElement("style");
globalStyle.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Syne:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { 
    background: linear-gradient(135deg, #0a0e1a 0%, #1a1f3a 100%); 
    color: #e8eaf0; 
    font-family: 'Inter', sans-serif; 
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  ::-webkit-scrollbar { width: 8px; } 
  ::-webkit-scrollbar-track { background: rgba(10,14,26,0.5); } 
  ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, #fbbf24, #f59e0b); border-radius: 4px; transition: background 0.3s; }
  ::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, #fcd34d, #fbbf24); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes slide-in { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
  @keyframes fade-in { from { opacity:0; } to { opacity:1; } }
  @keyframes pulse-glow { 0%,100% { box-shadow:0 0 0 0 rgba(251,191,36,0.4), inset 0 0 20px rgba(251,191,36,0.1); } 50% { box-shadow:0 0 30px 8px rgba(251,191,36,0.2), inset 0 0 20px rgba(251,191,36,0.15); } }
  @keyframes bounce-in { 0% { opacity:0; transform:scale(0.95); } 100% { opacity:1; transform:scale(1); } }
  @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-8px); } }
  .tab-btn { 
    background:transparent; 
    border:none; 
    color:#9ca3af; 
    font-family:'Inter',sans-serif; 
    font-size:13px; 
    font-weight:600; 
    letter-spacing:0.02em; 
    padding:10px 18px; 
    cursor:pointer; 
    border-bottom:2px solid transparent;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    white-space:nowrap;
  }
  .tab-btn:hover { 
    color:#fbbf24;
    transform: translateY(-1px);
  }
  .tab-btn.active { 
    color:#fbbf24; 
    border-bottom-color:#fbbf24;
    box-shadow: 0 4px 0 -2px rgba(251,191,36,0.3);
  }
  .card { 
    background: rgba(17,24,39,0.6);
    backdrop-filter: blur(10px);
    border:1px solid rgba(31,41,55,0.8); 
    border-radius:16px;
    transition: all 0.3s ease;
  }
  .card:hover { 
    border-color: rgba(251,191,36,0.3);
    box-shadow: 0 8px 24px rgba(251,191,36,0.1);
  }
  .result-enter { animation: slide-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }
  button { transition: all 0.3s ease; }
  input, textarea { transition: all 0.3s ease; }
`;
document.head.appendChild(globalStyle);


// ── Resizable two-column layout with drag handle ─────────────────────────────
function ResizableLayout({ result, onReset }) {
  const [sidebarW, setSidebarW] = useState(340);
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);
  const containerRef = useRef(null);

  const MIN_W = 260;
  const MAX_W = 600;

  const onMouseDown = useCallback((e) => {
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = sidebarW;
    document.body.style.cursor    = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarW]);

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next  = Math.min(MAX_W, Math.max(MIN_W, startW.current + delta));
      setSidebarW(next);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor     = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, []);

  return (
    <div ref={containerRef} className="result-enter"
      style={{ display:"flex", alignItems:"flex-start", height:"calc(100vh - 56px)", overflow:"hidden" }}>

      {/* ── SIDEBAR ── */}
      <div style={{
        width: sidebarW, flexShrink: 0,
        height: "100%", overflowY: "auto",
        paddingRight: 4, paddingTop: 2, paddingBottom: 24,
      }}>
        <ScoreSummary      result={result} />
        <AIBadge           aiDetection={result.ai_detection} />
        <SourceFetchStatus sourceFetch={result.source_fetch} />
        <SectionHeatmap    sectionScores={result.section_scores} />
        <button onClick={onReset} style={{
          width:"100%", marginTop:4,
          fontFamily:"'IBM Plex Mono',monospace", fontSize:11, fontWeight:600,
          padding:"9px", borderRadius:8, border:"1px solid #374151",
          background:"#111827", color:"#9ca3af", cursor:"pointer",
          letterSpacing:"0.06em",
        }}>
          ← Check another document
        </button>
      </div>

      {/* ── DRAG HANDLE ── */}
      <div
        onMouseDown={onMouseDown}
        style={{
          width: 6, flexShrink: 0, height: "100%",
          cursor: "col-resize", position: "relative",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 4px",
        }}
      >
        {/* Visible track */}
        <div style={{
          width: 2, height: "100%",
          background: "#1f2937",
          transition: "background 0.15s",
        }} />
        {/* Grip dots */}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          display: "flex", flexDirection: "column", gap: 3,
        }}>
          {[0,1,2,3,4].map(i => (
            <div key={i} style={{ width:3, height:3, borderRadius:"50%", background:"#374151" }} />
          ))}
        </div>
        {/* Hover highlight — CSS-only via onMouseEnter/Leave */}
        <style>{`
          .drag-handle:hover > div:first-child { background: #fbbf24 !important; }
          .drag-handle:hover { background: rgba(251,191,36,0.04) !important; border-radius: 4px; }
        `}</style>
      </div>

      {/* ── MAIN RESULTS ── */}
      <div style={{
        flex: 1, minWidth: 0,
        height: "100%", overflowY: "auto",
        paddingLeft: 4, paddingTop: 2, paddingBottom: 24,
      }}>
        <ResultsView
          sentences={result.sentences}
          submissionId={result.submission_id}
        />
      </div>
    </div>
  );
}

export default function App() {
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab,     setTab]     = useState("checker");
  const [stats,   setStats]   = useState(null);

  useEffect(() => {
    getStats().then(setStats).catch(() => {});
  }, [result]);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a" }}>

      {/* ── Nav ── */}
      <nav style={{
        background: "rgba(10,14,26,0.7)", 
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(31,41,55,0.4)",
        position: "sticky", 
        top: 0, 
        zIndex: 100,
        padding: "0 32px", 
        display: "flex", 
        alignItems: "center",
        justifyContent: "space-between", 
        height: 70,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ 
            width: 44, 
            height: 44, 
            background: "linear-gradient(135deg, #fbbf24, #f59e0b)", 
            borderRadius: 12, 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            fontSize: 24,
            boxShadow: "0 8px 24px rgba(251,191,36,0.3)",
            animation: "float 3s ease-in-out infinite"
          }}>🔍</div>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color: "#f9fafb", letterSpacing: "-0.02em" }}>PlagDetect</div>
            <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 11, color: "#6b7280", letterSpacing: "0.05em", fontWeight: 500 }}>AI-Powered Plagiarism Detection</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {[["checker","⬡ Checker"],["network","◈ Network"],["stats","◇ Stats"]].map(([k,l]) => (
            <button key={k} className={`tab-btn${tab===k?" active":""}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {stats && (
            <div style={{ 
              fontFamily: "'Inter',sans-serif", 
              fontSize: 12, 
              color: "#9ca3af", 
              background: "rgba(17,24,39,0.6)",
              border: "1px solid rgba(31,41,55,0.8)", 
              padding: "6px 14px", 
              borderRadius: 24,
              backdropFilter: "blur(10px)",
              transition: "all 0.3s ease"
            }}>
              📚 {stats.corpus?.total_sentences?.toLocaleString() ?? "—"} corpus sentences
            </div>
          )}
          {result && (
            <div style={{
              fontFamily: "'Inter',sans-serif", 
              fontSize: 12, 
              fontWeight: 600,
              padding: "6px 14px", 
              borderRadius: 24,
              background: {HIGH_RISK:"rgba(239,68,68,0.12)",MEDIUM_RISK:"rgba(245,158,11,0.12)",LOW_RISK:"rgba(251,146,60,0.12)",CLEAN:"rgba(52,211,153,0.12)"}[result.label] || "rgba(17,24,39,0.6)",
              color:      {HIGH_RISK:"#ef4444",MEDIUM_RISK:"#f59e0b",LOW_RISK:"#fb923c",CLEAN:"#34d399"}[result.label] || "#9ca3af",
              border:     `1px solid rgba(${
                {HIGH_RISK:"239,68,68",MEDIUM_RISK:"245,158,11",LOW_RISK:"251,146,60",CLEAN:"52,211,153"}[result.label]||"31,41,55"
              },0.3)`,
              backdropFilter: "blur(10px)",
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              {result.label === "HIGH_RISK" && "🚩"}
              {result.label === "MEDIUM_RISK" && "⚠️ "}
              {result.label === "LOW_RISK" && "✓ "}
              {result.label === "CLEAN" && "✅"}
              {result.label?.replace(/_/g," ")} · {result.overall_score}%
            </div>
          )}
        </div>
      </nav>

      {/* ── CHECKER TAB ── */}
      {tab === "checker" && (
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 24px" }}>

          {loading && (
            <div style={{
              display:"flex", alignItems:"center", gap:16,
              background:"rgba(251,191,36,0.08)", 
              border:"1px solid rgba(251,191,36,0.3)",
              borderRadius:14, 
              padding:"16px 22px", 
              marginBottom:24,
              animation:"pulse-glow 2s ease infinite",
              backdropFilter: "blur(10px)",
            }}>
              <div style={{ width:18,height:18,borderRadius:"50%",border:"2px solid rgba(251,191,36,0.2)",borderTop:"2px solid #fbbf24",animation:"spin 0.8s linear infinite",flexShrink:0 }} />
              <div>
                <div style={{ fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"#fbbf24" }}>Analyzing Document</div>
                <div style={{ fontFamily:"'Inter',sans-serif",fontSize:11,color:"#9ca3af",marginTop:3 }}>
                  Running plagiarism detection • Fetching corpus sources • Analyzing patterns
                </div>
              </div>
            </div>
          )}

          {/* Two-column resizable layout */}
          {result ? (
            <ResizableLayout result={result} onReset={() => setResult(null)} />

          ) : (
            /* ── No results: centered upload form ── */
            <div style={{ maxWidth: 700, margin: "0 auto", animation:"fade-in 0.5s ease" }}>
              <div style={{ textAlign:"center", padding:"48px 0 32px" }}>
                <div style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:36,color:"#f9fafb",marginBottom:12, letterSpacing: "-0.02em" }}>
                  Detect Plagiarism
                </div>
                <div style={{ fontFamily:"'Inter',sans-serif",fontSize:16,color:"#9ca3af", lineHeight: 1.6 }}>
                  Analyze documents for plagiarism with our advanced 3-layer detection system. Supports PDF, DOCX, and TXT formats in 50+ languages.
                </div>
              </div>
              <UploadForm onResult={setResult} onLoading={setLoading} />
            </div>
          )}
        </div>
      )}

      {/* ── NETWORK TAB ── */}
      {tab === "network" && (
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 24px" }}>
          <NetworkGraph />
        </div>
      )}

      {/* ── STATS TAB ── */}
      {tab === "stats" && (
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 24px", animation:"slide-in 0.3s ease" }}>
          <div style={{ marginBottom:24 }}>
            <div style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,color:"#f9fafb",marginBottom:4 }}>System Stats</div>
            <div style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:"#4b5563" }}>Live cache and corpus metrics</div>
          </div>

          {stats ? (
            <>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
                {[
                  { label:"Cached Sentences", value:stats.cache?.cached_sentences?.toLocaleString()??"—", color:"#60a5fa", icon:"◈" },
                  { label:"Cache Hit Rate",   value:stats.cache?.hit_rate??"—",                           color:"#34d399", icon:"◇" },
                  { label:"Corpus Size",      value:stats.corpus?.total_sentences?.toLocaleString()??"—", color:"#a78bfa", icon:"⬡" },
                  { label:"Submissions",      value:stats.submissions_total??"—",                         color:"#fbbf24", icon:"◉" },
                ].map(({ label,value,color,icon }) => (
                  <div key={label} className="card" style={{ padding:"18px 16px" }}>
                    <div style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:9,color:"#4b5563",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.1em" }}>
                      {icon} {label}
                    </div>
                    <div style={{ fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:28,color }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* API reference — full width */}
              <div className="card" style={{ padding:20 }}>
                <div style={{ fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"#f9fafb",marginBottom:14 }}>API Reference</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 32px" }}>
                  {[
                    ["POST","/check/text",        "Check pasted text"],
                    ["POST","/check/file",        "Upload PDF / DOCX / TXT"],
                    ["POST","/compare/batch",     "Compare N students"],
                    ["POST","/feedback/sentence", "Rewrite suggestions"],
                    ["POST","/detect/ai",         "AI-content detection"],
                    ["GET", "/report/{id}",       "Download PDF report"],
                    ["GET", "/pairs",             "Student similarity pairs"],
                    ["GET", "/submissions",       "Submission history"],
                    ["GET", "/stats",             "Cache + corpus stats"],
                    ["GET", "/docs",              "Swagger interactive docs"],
                  ].map(([method,path,desc]) => (
                    <div key={path} style={{ display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #1f2937" }}>
                      <span style={{
                        fontFamily:"'IBM Plex Mono',monospace",fontSize:9,fontWeight:700,
                        padding:"2px 7px",borderRadius:4,whiteSpace:"nowrap",
                        background: method==="GET"?"#052e16":"#1e1b4b",
                        color:      method==="GET"?"#34d399":"#818cf8",
                        border:`1px solid ${method==="GET"?"#064e3b":"#312e81"}`,
                      }}>{method}</span>
                      <code style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:11,color:"#fbbf24",minWidth:160 }}>{path}</code>
                      <span style={{ fontSize:12,color:"#6b7280" }}>{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontFamily:"'IBM Plex Mono',monospace",fontSize:12,color:"#4b5563",padding:20 }}>
              Loading… (is the backend running on :8000?)
            </div>
          )}
        </div>
      )}
    </div>
  );
}