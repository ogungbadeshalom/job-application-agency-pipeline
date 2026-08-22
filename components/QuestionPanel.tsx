'use client';

import { useEffect, useState } from 'react';
import { Copy, Search, Spinner } from './Icon';
import type { QuestionSnippet } from '@/lib/types';

export default function QuestionPanel({
  profileId,
  jobId,
}: {
  profileId: string;
  jobId: string;
}) {
  const [question, setQuestion] = useState('');
  const [context, setContext] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [snippets, setSnippets] = useState<QuestionSnippet[]>([]);
  const [snipSearch, setSnipSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/snippets?profile_id=${profileId}`)
      .then(async (r) => {
        if (!r.ok) return [];
        // Guard against a non-JSON error body ("Unexpected token '<'").
        return (await r.json().catch(() => [])).snippets ?? [];
      })
      .then((list: QuestionSnippet[]) => {
        if (!cancelled) setSnippets(list);
      })
      .catch(() => {
        if (!cancelled) setSnippets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  async function getAnswer() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, question, context }),
      });
      // Check res.ok BEFORE res.json() so an HTML error page doesn't throw
      // "Unexpected token '<'" instead of surfacing the real error.
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Failed to generate answer');
      }
      // Parse defensively so an HTML/oddly-empty body can't throw
      // "Unexpected token '<'".
      const data = (await res.json().catch(() => null)) ?? {};
      if (typeof data.answer !== 'string') {
        throw new Error('No answer returned. Please try again.');
      }
      setAnswer(data.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function copy(text: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Clipboard unavailable — copy the text manually from the box below.');
    }
  }

  async function saveSnippet() {
    if (!question.trim() || !answer.trim()) return;
    try {
      const res = await fetch('/api/snippets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, question, answer }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (data?.snippet) {
        setSnippets((s) => [data.snippet, ...s]);
      }
    } catch {
      // ignore; saving a snippet is best-effort
    }
  }

  const filteredSnippets = snippets.filter(
    (s) =>
      !snipSearch ||
      (s.question || '').toLowerCase().includes(snipSearch.toLowerCase()) ||
      (s.answer || '').toLowerCase().includes(snipSearch.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <div>
          <label className="block th-uppercase mb-1">Question</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Paste the application question…"
            className="w-full h-20 bg-navy-950 border border-navy-700 rounded-md p-2.5 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
          />
        </div>
        <div>
          <label className="block th-uppercase mb-1">Context (optional)</label>
          <input
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="e.g. max 150 words, STAR format…"
            className="w-full bg-navy-950 border border-navy-700 rounded-md px-2.5 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={getAnswer}
            disabled={loading || !question.trim()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-brand-green/15 text-brand-green hover:bg-brand-green/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Spinner /> : null}
            Get AI Answer
          </button>
          {answer && (
            <>
              <button
                onClick={() => copy(answer)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
              >
                <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={saveSnippet}
                className="px-3 py-1.5 text-sm rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
              >
                Save to library
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {answer && (
        <div className="panel p-4">
          <h3 className="text-sm font-semibold text-navy-200 mb-2">Answer</h3>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            className="w-full h-40 bg-navy-950 border border-navy-700 rounded-md p-3 text-sm text-navy-100 focus:outline-none focus:border-brand-blue resize-y"
          />
        </div>
      )}

      {/* Snippets library */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-navy-700">
          <h3 className="text-sm font-semibold text-navy-200">Saved Q&amp;A library</h3>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-navy-500" />
            <input
              value={snipSearch}
              onChange={(e) => setSnipSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8 pr-2 py-1 text-sm bg-navy-950 border border-navy-700 rounded-md text-navy-100 placeholder:text-navy-500 focus:outline-none focus:border-brand-blue w-48"
            />
          </div>
        </div>
        <div className="divide-y divide-navy-800 max-h-72 overflow-y-auto">
          {filteredSnippets.length === 0 && (
            <div className="p-4 text-sm text-navy-500">No saved snippets yet.</div>
          )}
          {filteredSnippets.map((s) => (
            <div key={s.id} className="p-3 hover:bg-navy-850">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-navy-200">{s.question || ''}</div>
                <button
                  onClick={() => copy(s.answer || '')}
                  className="text-navy-500 hover:text-navy-200 shrink-0"
                  title="Copy answer"
                >
                  <Copy size={14} />
                </button>
              </div>
              <p className="text-xs text-navy-400 mt-1">{s.answer || ''}</p>
              <div className="text-[10px] text-navy-600 mt-1">
                Used {typeof s.use_count === 'number' ? s.use_count : 0}×
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
