// UploadForm.jsx — redesigned with modern UI
import { useState } from "react";
import { checkText, checkFile } from "../api";

export default function UploadForm({ onResult, onLoading }) {
  const [mode,        setMode]        = useState("text");
  const [text,        setText]        = useState("");
  const [file,        setFile]        = useState(null);
  const [studentName, setStudentName] = useState("");
  const [sources,     setSources]     = useState(["wikipedia", "arxiv"]);
  const [error,       setError]       = useState("");
  const [dragOver,    setDragOver]    = useState(false);

  function toggleSource(s) {
    setSources(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s]);
  }

  async function handleSubmit() {
    setError("");
    if (mode === "text" && text.trim().length < 50) { setError("Please enter at least 50 characters"); return; }
    if (mode === "file" && !file) { setError("Please select a file"); return; }
    if (!sources.length) { setError("Please select at least one source"); return; }
    onLoading(true);
    try {
      const trimmedName = studentName.trim();
      const result = mode === "text"
        ? await checkText(text, sources, trimmedName)
        : await checkFile(file, sources, trimmedName);
      onResult(result);
    } catch (e) {
      setError(e.message);
    } finally {
      onLoading(false);
    }
  }

  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && /\.(pdf|docx|txt)$/i.test(f.name)) { setFile(f); setMode("file"); }
  }

  const sourceList = [
    { key: "wikipedia", label: "Wikipedia",   icon: "📖" },
    { key: "arxiv",     label: "arXiv",       icon: "🔬" },
    { key: "ieee",      label: "IEEE Xplore", icon: "⚡" },
    { key: "stored",    label: "Stored DB",   icon: "💾" },
  ];

  return (
    <div style={{
      background: "rgba(17,24,39,0.7)",
      border: "1px solid rgba(31,41,55,0.8)",
      borderRadius: 20,
      marginBottom: 24,
      overflow: "hidden",
      backdropFilter: "blur(10px)",
      transition: "all 0.3s ease"
    }}>
      {/* Header */}
      <div style={{
        padding: "24px 28px",
        borderBottom: "1px solid rgba(31,41,55,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(251,191,36,0.04)"
      }}>
        <div>
          <div style={{ 
            fontFamily: "'Syne', sans-serif", 
            fontWeight: 700, 
            fontSize: 18, 
            color: "#f9fafb",
            letterSpacing: "-0.01em"
          }}>
            Upload Document
          </div>
          <div style={{ 
            fontFamily: "'Inter', sans-serif", 
            fontSize: 12, 
            color: "#9ca3af", 
            marginTop: 3 
          }}>
            Analyze any document for plagiarism instantly
          </div>
        </div>
        {/* Mode toggle */}
        <div style={{
          display: "flex",
          background: "rgba(10,14,26,0.6)",
          border: "1px solid rgba(31,41,55,0.8)",
          borderRadius: 10,
          padding: 4,
          gap: 2,
        }}>
          {[["text","✏️ Text"],["file","📎 File"]].map(([m, label]) => (
            <button 
              key={m} 
              onClick={() => setMode(m)} 
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 16px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                background: mode === m 
                  ? "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(245,158,11,0.1))"
                  : "transparent",
                color: mode === m ? "#fbbf24" : "#6b7280",
                transition: "all 0.3s ease",
                boxShadow: mode === m ? "0 0 12px rgba(251,191,36,0.2)" : "none"
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: "28px 28px" }}>
        {/* Student name */}
        <div style={{ marginBottom: 20 }}>
          <label style={s.label}>👤 Student Name <span style={{ color: "#4b5563" }}>(optional)</span></label>
          <input
            value={studentName}
            onChange={e => setStudentName(e.target.value)}
            placeholder="e.g. John Doe"
            style={{
              ...s.input,
              borderColor: studentName ? "rgba(251,191,36,0.4)" : "rgba(31,41,55,0.8)",
              boxShadow: studentName ? "0 0 12px rgba(251,191,36,0.1) inset" : "none"
            }}
          />
        </div>

        {/* Sources */}
        <div style={{ marginBottom: 20 }}>
          <label style={s.label}>🔗 Reference Sources</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {sourceList.map(({ key, label, icon }) => {
              const active = sources.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggleSource(key)}
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "8px 14px",
                    borderRadius: 8,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    background: active
                      ? "linear-gradient(135deg, rgba(96,165,250,0.2), rgba(59,130,246,0.1))"
                      : "rgba(10,14,26,0.6)",
                    color: active ? "#60a5fa" : "#6b7280",
                    border: active ? "1px solid rgba(96,165,250,0.4)" : "1px solid rgba(31,41,55,0.8)",
                    transition: "all 0.3s ease",
                    boxShadow: active ? "0 0 12px rgba(96,165,250,0.15)" : "none"
                  }}>
                  <span style={{ fontSize: 16 }}>{icon}</span>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Text area */}
        {mode === "text" && (
          <div style={{ marginBottom: 20 }}>
            <label style={s.label}>
              📝 Document Text
              <span style={{ color: "#4b5563", fontWeight: 400, marginLeft: 8, float: "right" }}>
                {text.length} / 50+ chars
              </span>
            </label>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Paste the document here…"
              rows={9}
              style={{
                ...s.input,
                resize: "vertical",
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                lineHeight: 1.7,
                minHeight: 200,
                borderColor: text ? "rgba(251,191,36,0.4)" : "rgba(31,41,55,0.8)",
                boxShadow: text ? "0 0 12px rgba(251,191,36,0.1) inset" : "none"
              }}
            />
            <div style={{
              fontSize: 11,
              color: text.length >= 50 ? "#34d399" : "#6b7280",
              marginTop: 6,
              fontFamily: "'Inter', sans-serif"
            }}>
              {text.length >= 50
                ? "✅ Minimum length met"
                : `⚠️ ${50 - text.length} more characters needed`}
            </div>
          </div>
        )}

        {/* File drop zone */}
        {mode === "file" && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            style={{
            border: `2px dashed ${dragOver ? "#fbbf24" : file ? "#34d399" : "rgba(251,191,36,0.3)"}`,
              borderRadius: 14,
              padding: "40px 24px",
              textAlign: "center",
              marginBottom: 20,
              cursor: "pointer",
              background: dragOver
                ? "rgba(251,191,36,0.08)"
                : file
                ? "rgba(52,211,153,0.08)"
                : "rgba(251,191,36,0.04)",
              transition: "all 0.3s ease",
              animation: dragOver ? "bounce-in 0.3s ease" : "none"
            }}
          >
            <label style={{ cursor: "pointer", display: "block" }}>
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                style={{ display: "none" }}
                onChange={e => setFile(e.target.files[0])}
              />
              {file ? (
                <>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                  <div style={{
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    color: "#34d399"
                  }}>
                    {file.name}
                  </div>
                  <div style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    color: "#6b7280",
                    marginTop: 6
                  }}>
                    {(file.size / 1024).toFixed(1)} KB • Click to change
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.4 }}>⬆️</div>
                  <div style={{
                    fontFamily: "'Syne', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    color: "#9ca3af"
                  }}>
                    Drop your file here or click to browse
                  </div>
                  <div style={{
                    fontFamily: "'Inter', sans-serif",
                    fontSize: 12,
                    color: "#6b7280",
                    marginTop: 6
                  }}>
                    Supports PDF, DOCX, and TXT files
                  </div>
                </>
              )}
            </label>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 20,
            fontFamily: "'Inter', sans-serif",
            fontSize: 13,
            color: "#fca5a5",
            display: "flex",
            alignItems: "center",
            gap: 8,
            animation: "slide-in 0.3s ease"
          }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            {error}
          </div>
        )}

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          style={{
            width: "100%",
            padding: "14px 20px",
            background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
            color: "#000",
            border: "none",
            borderRadius: 12,
            fontFamily: "'Syne', sans-serif",
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
            letterSpacing: "0.02em",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            boxShadow: "0 8px 24px rgba(251,191,36,0.3)",
            position: "relative",
            overflow: "hidden"
          }}
          onMouseOver={e => {
            e.target.style.transform = "translateY(-2px)";
            e.target.style.boxShadow = "0 12px 32px rgba(251,191,36,0.4)";
          }}
          onMouseOut={e => {
            e.target.style.transform = "translateY(0)";
            e.target.style.boxShadow = "0 8px 24px rgba(251,191,36,0.3)";
          }}
          onMouseDown={e => {
            e.target.style.transform = "translateY(1px)";
          }}
        >
          Run Plagiarism Check →
        </button>
      </div>
    </div>
  );
}

const s = {
  label: {
    display: "block",
    fontFamily: "'Inter', sans-serif",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "#e8eaf0",
    marginBottom: 10,
  },
  input: {
    width: "100%",
    padding: "11px 14px",
    background: "rgba(10,14,26,0.6)",
    border: "1px solid rgba(31,41,55,0.8)",
    borderRadius: 10,
    fontSize: 14,
    color: "#f9fafb",
    outline: "none",
    fontFamily: "'Inter', sans-serif",
    transition: "all 0.3s ease",
  },
};