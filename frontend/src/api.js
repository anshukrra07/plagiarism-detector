const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000' 

async function fetchJson(path, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type") || "";
    const body = contentType.includes("application/json")
      ? await res.json()
      : await res.text();

    if (!res.ok) {
      const detail = typeof body === "string" ? body : body?.detail || body?.error;
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out for ${path}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkText(text, sources = ["wikipedia", "arxiv"], studentName = "") {
  return fetchJson("/check/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      auto_fetch_corpus: true,
      sources,
      student_name: studentName || null,
    }),
  }, 300000);
}

export async function checkFile(file, sources = ["wikipedia", "arxiv"], studentName = "") {
  const form = new FormData();
  form.append("file", file);
  if (studentName) {
    form.append("student_name", studentName);
  }
  for (const source of sources) form.append("sources", source);
  return fetchJson("/check/file", { method: "POST", body: form }, 300000);
}

// FIX [MEDIUM]: accepts optional timestamps for arrow direction feature
// students = [{ name: "Alice", text: "...", timestamp: "2026-03-13T09:00:00" }, ...]
export async function compareBatch(students, threshold = 0.70) {
  return fetchJson("/compare/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts:      students.map(s => s.text),
      labels:     students.map(s => s.name),
      threshold,
      timestamps: students.every(s => s.timestamp)
        ? students.map(s => s.timestamp)
        : undefined,  // omit field if any timestamp is missing
    }),
  }, 120000);
}

export async function getPairs(threshold = 0.70) {
  return fetchJson(`/pairs?threshold=${threshold}`, {}, 10000);
}

export async function getSubmissions(limit = 20) {
  return fetchJson(`/submissions?limit=${limit}`, {}, 10000);
}

export async function getSubmission(submissionId) {
  return fetchJson(`/submissions/${submissionId}`, {}, 10000);
}

export async function getStats() {
  return fetchJson("/stats", {}, 5000);
}

export async function detectAI(text) {
  return fetchJson("/detect/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }, 60000);
}
