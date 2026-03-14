// SourceFetchStatus.jsx — improved with modern UI
export default function SourceFetchStatus({ sourceFetch, compact }) {
  if (!sourceFetch?.selected_sources?.length) return null;

  const labels = { wikipedia: "Wikipedia", arxiv: "arXiv", ieee: "IEEE Xplore", stored: "Stored DB" };

  const tone = s => ({
    ok:      { color: "#34d399", bg: "rgba(52,211,153,0.08)", border: "#34d399", icon: "✓" },
    error:   { color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "#ef4444", icon: "✕" },
    skipped: { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "#f59e0b", icon: "⊘" },
    local:   { color: "#9ca3af", bg: "rgba(156,163,175,0.08)", border: "#9ca3af", icon: "◉" },
    empty:   { color: "#6b7280", bg: "rgba(107,114,128,0.08)", border: "#6b7280", icon: "◦" },
  }[s] || { color: "#6b7280", bg: "rgba(107,114,128,0.08)", border: "#6b7280", icon: "◦" });

  const humanStatus = s => ({
    ok: "Fetched", error: "Failed", skipped: "Skipped",
    empty: "No results", local: "Local DB", pending: "Pending",
  }[s] || "—");

  return (
    <div style={{
      background: "rgba(17,24,39,0.6)",
      border: "1px solid rgba(31,41,55,0.8)",
      borderRadius: 16,
      padding: "18px 20px",
      marginBottom: 18,
      backdropFilter: "blur(10px)",
      transition: "all 0.3s ease"
    }}>
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 14
      }}>
        <span style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
          fontWeight: 700,
          color: "#e8eaf0",
          letterSpacing: "0.02em"
        }}>
          🔗 Source Fetch Status
        </span>
        {sourceFetch.has_errors && (
          <span style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            color: "#ef4444",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            padding: "4px 10px",
            borderRadius: 6,
            fontWeight: 600
          }}>
            ⚠️ Some sources failed
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {sourceFetch.selected_sources.map(src => {
          const info = sourceFetch.sources?.[src];
          const t    = tone(info?.status);
          return (
            <div
              key={src}
              style={{
                background: t.bg,
                border: `1px solid ${t.border}40`,
                borderRadius: 10,
                padding: "12px 14px",
                minWidth: 140,
                transition: "all 0.3s ease"
              }}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 6
              }}>
                <span style={{ fontSize: 14 }}>{t.icon}</span>
                <div style={{ flex: 1 }}>
                  <span style={{
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 700,
                    fontSize: 12,
                    color: t.color
                  }}>
                    {labels[src] || src}
                  </span>
                </div>
                <span style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 11,
                  color: t.color,
                  fontWeight: 600
                }}>
                  {humanStatus(info?.status)}
                </span>
              </div>
              <div style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 11,
                color: "#9ca3af"
              }}>
                {info?.added ?? 0} added · {info?.fetched ?? 0} fetched
              </div>
              {info?.error && (
                <div style={{
                  marginTop: 6,
                  padding: "6px 8px",
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 10,
                  color: "#ef4444",
                  background: "rgba(239,68,68,0.1)",
                  borderRadius: 4,
                  border: "1px solid rgba(239,68,68,0.2)"
                }}>
                  {info.error.slice(0, 50)}...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
