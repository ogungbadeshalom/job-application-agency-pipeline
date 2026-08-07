'use client';

import { useEffect, useState } from 'react';
import { Spinner } from '@/components/Icon';
import { LabeledInput } from './shared';

type Provider = 'anthropic' | 'openrouter' | 'custom' | 'deepseek';

interface ConfigResponse {
  ai_provider: Provider;
  ai_model: string;
  ai_base_url: string | null;
  api_key_masked: string;
  api_key_set: boolean;
  updated_at: string | null;
}

// Admin-only AI provider configuration. Settings persist in app_config (DB),
// encrypted-at-rest. The plaintext key is only sent in the PUT body.
export default function AIConfigPanel() {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [provider, setProvider] = useState<Provider>('custom');
  const [model, setModel] = useState('claude-sonnet-5');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then(async (r) => {
        if (!r.ok) throw new Error('Load failed');
        // Guard against a non-JSON error body ("Unexpected token '<'").
        return (await r.json().catch(() => null)) as ConfigResponse | null;
      })
      .then((d) => {
        if (cancelled || !d) return;
        setCfg(d);
        setProvider(d.ai_provider);
        setModel(d.ai_model);
        setBaseUrl(d.ai_base_url ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('Could not load AI config.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      // If user didn't touch the key, send "__KEEP__" so PUT preserves existing.
      const apiKeyToSend = apiKey === '' ? '__KEEP__' : apiKey;
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model,
          baseUrl: baseUrl || null,
          apiKey: apiKeyToSend,
        }),
      });
      // Check res.ok BEFORE reading JSON so an HTML error body doesn't crash.
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error || 'Save failed');
      }
      const data: ConfigResponse = await res.json();
      setCfg(data);
      setApiKey(''); // clear the input after saving
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    if (typeof window !== 'undefined' && !window.confirm('Remove the stored API key?')) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, baseUrl: baseUrl || null, apiKey: '' }),
      });
      if (!res.ok) throw new Error('Failed');
      const data: ConfigResponse = await res.json().catch(() => null);
      if (data) setCfg(data);
      setApiKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="p-3 border-b border-navy-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-navy-200">AI Configuration</h3>
          <p className="text-xs text-navy-500 mt-0.5">
            Provider + model + key. Stored encrypted-at-rest (AES-256-GCM).
          </p>
        </div>
        {cfg && (
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              cfg.api_key_set
                ? 'bg-emerald-500/15 text-brand-green'
                : 'bg-yellow-500/15 text-brand-yellow'
            }`}
          >
            {cfg.api_key_set
              ? `Connected · ${cfg.ai_provider} · ${cfg.api_key_masked}`
              : 'Not configured'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="p-6 flex items-center justify-center text-navy-500 text-sm">
          <Spinner />
        </div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block th-uppercase mb-1">Provider</label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
                className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              >
                <option value="anthropic">Anthropic</option>
                <option value="openrouter">OpenRouter</option>
                <option value="deepseek">DeepSeek</option>
                <option value="custom">Custom (OpenAI-compatible)</option>
              </select>
            </div>
            <LabeledInput label="Model" value={model} onChange={setModel} placeholder="claude-sonnet-5" />
          </div>

          <div>
            <label className="block th-uppercase mb-1">Base URL {provider !== 'custom' && <span className="text-navy-500">(optional for this provider)</span>}</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === 'openrouter' ? 'https://openrouter.ai/api/v1'
                : provider === 'deepseek' ? 'https://api.deepseek.com/v1'
                : provider === 'custom' ? 'https://freeinference.org/v1'
                : ''
              }
              disabled={provider === 'anthropic'}
              className="w-full bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block th-uppercase mb-1">
              API key {cfg?.api_key_set && <span className="text-navy-500">(currently {cfg.api_key_masked}; leave blank to keep)</span>}
            </label>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={cfg?.api_key_set ? '••••••••••••' : 'paste key here'}
                autoComplete="off"
                className="flex-1 bg-navy-950 border border-navy-700 rounded-md px-3 py-2 text-sm text-navy-100 focus:outline-none focus:border-brand-blue"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="px-3 py-2 text-xs rounded-md bg-navy-800 text-navy-200 hover:bg-navy-750"
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
              {cfg?.api_key_set && (
                <button
                  type="button"
                  onClick={clearKey}
                  disabled={saving}
                  className="px-3 py-2 text-xs rounded-md bg-red-500/15 text-brand-red hover:bg-red-500/25"
                >
                  Remove key
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="text-sm text-brand-red bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={save}
              disabled={saving || !model}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-brand-greenDark text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? <Spinner /> : null}
              Save
            </button>
            {savedAt && <span className="text-xs text-brand-green">✓ Saved</span>}
            {cfg?.updated_at && (
              <span className="text-xs text-navy-500">
                Last updated {new Date(cfg.updated_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}