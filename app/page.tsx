"use client";

import { useMemo, useState } from "react";
import { humanize, type Intensity } from "@/lib/humanizer";

const SIGIL = (
  <svg className="sigil" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    <path
      d="M16 4 L16 28 M4 16 L28 16"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.35"
    />
    <circle cx="16" cy="16" r="5" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

const SIGIL_SPIN = (
  <svg className="sigil-spin" viewBox="0 0 32 32" fill="none">
    <circle cx="16" cy="16" r="13" stroke="#f7e9e2" strokeWidth="2" opacity="0.3" />
    <path
      d="M16 3 A13 13 0 0 1 29 16"
      stroke="#f7e9e2"
      strokeWidth="2"
      strokeLinecap="round"
    />
  </svg>
);

const INTENSITY_OPTIONS: { id: Intensity; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "medium", label: "Medium" },
  { id: "heavy", label: "Heavy" },
];

const MAX_CHARS = 20000;
// Purely cosmetic — gives the "Transmute" action a beat of weight instead
// of an instant snap, since the real computation is sub-millisecond.
const PROCESSING_DELAY_MS = 450;

export default function Page() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [edits, setEdits] = useState<number | null>(null);
  const [intensity, setIntensity] = useState<Intensity>("medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const wordCount = useMemo(
    () => (input.trim() ? input.trim().split(/\s+/).length : 0),
    [input]
  );

  const charCount = input.length;
  const overLimit = charCount > MAX_CHARS;

  function runHumanize() {
    if (!input.trim() || loading || overLimit) return;
    setLoading(true);
    setError("");

    // setTimeout (not async work) — the algorithm itself is synchronous and
    // instant; this just lets the loading state paint before we block the
    // main thread for the split second the regex passes take on long text.
    setTimeout(() => {
      try {
        const result = humanize(input, intensity);
        setOutput(result.text);
        setEdits(result.edits);
      } catch (err: any) {
        setError(err?.message || "Something went wrong while rewriting.");
      } finally {
        setLoading(false);
      }
    }, PROCESSING_DELAY_MS);
  }

  async function handleCopy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handlePaste() {
    navigator.clipboard.readText().then((text) => setInput(text));
  }

  return (
    <main>
      <div className="header">
        <div>
          <h1 className="wordmark">
            {SIGIL}
            Red Quill
          </h1>
          <div className="tagline">AI prose, rewritten human</div>
        </div>
        <div className="status-pill">
          <span className="dot" />
          100% local · no API
        </div>
      </div>

      <div className="controls-row">
        <div className="intensity-group">
          {INTENSITY_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`intensity-btn ${intensity === opt.id ? "active" : ""}`}
              onClick={() => setIntensity(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className={`char-count ${overLimit ? "warn" : ""}`}>
          {wordCount} words · {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} chars
        </div>
      </div>

      <div className="panels">
        <div className="panel">
          <div className="panel-head">
            <span className="panel-label">Raw Draft</span>
            <button className="panel-action" onClick={handlePaste}>
              Paste
            </button>
          </div>
          <textarea
            placeholder="Paste AI-generated text here…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-label crimson">
              Transmuted
              {edits !== null && output && (
                <span className="edits-badge">{edits} edits</span>
              )}
            </span>
            <button className="panel-action" onClick={handleCopy} disabled={!output}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {output ? (
            <div className="output-text">{output}</div>
          ) : (
            <div className="output-empty">
              {loading ? "Rewriting…" : "Your rewritten text will appear here."}
            </div>
          )}
        </div>
      </div>

      <div className="action-row">
        <button
          className="transmute-btn"
          onClick={runHumanize}
          disabled={loading || !input.trim() || overLimit}
        >
          {loading && SIGIL_SPIN}
          {loading ? "Transmuting" : "Transmute"}
        </button>
        {output && !loading && (
          <button className="reroll-btn" onClick={runHumanize}>
            Reroll
          </button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="footer">
        <span>Red Quill — personal project, runs entirely in your browser</span>
        <span>Preserves meaning. Rewrites voice.</span>
      </div>
    </main>
  );
}
