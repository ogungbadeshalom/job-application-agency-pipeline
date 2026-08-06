import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { clearAIConfigCache } from '@/lib/ai';
import type { AppConfig } from '@/lib/types';

function maskKey(apiKey: string | null): string {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••';
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

// GET /api/config  (admin) — current AI provider settings. The API key is
// returned masked (first 4 + last 4); the full plaintext stays in the DB.
export async function GET() {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cfg = await db.getAppConfig();
  if (!cfg) {
    return NextResponse.json({
      ai_provider: 'anthropic',
      ai_model: 'claude-sonnet-5',
      ai_base_url: null,
      api_key_masked: '',
      api_key_set: false,
      updated_at: null,
    });
  }
  return NextResponse.json({
    ai_provider: cfg.ai_provider,
    ai_model: cfg.ai_model,
    ai_base_url: cfg.ai_base_url,
    api_key_masked: maskKey(cfg.ai_api_key),
    api_key_set: !!cfg.ai_api_key,
    updated_at: cfg.updated_at,
  });
}

// PUT /api/config  (admin)
// Body: { provider, model, baseUrl?, apiKey? }
//   apiKey === "__KEEP__"   -> keep existing key
//   apiKey === "" or null   -> remove key
//   anything else           -> replace key
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    model?: string;
    baseUrl?: string | null;
    apiKey?: string | null;
  };

  if (!body.provider || !['anthropic', 'openrouter', 'custom', 'deepseek'].includes(body.provider)) {
    return NextResponse.json({ error: 'provider must be anthropic | openrouter | custom | deepseek' }, { status: 400 });
  }
  if (!body.model || !body.model.trim()) {
    return NextResponse.json({ error: 'model is required' }, { status: 400 });
  }
  if (body.provider === 'custom' && !body.baseUrl) {
    return NextResponse.json({ error: 'baseUrl is required when provider is "custom"' }, { status: 400 });
  }

  // Resolve final apiKey value.
  let apiKey: string | null;
  if (body.apiKey === '__KEEP__') {
    const current = await db.getAppConfig();
    apiKey = current?.ai_api_key ?? null;
  } else if (body.apiKey === '' || body.apiKey === null || body.apiKey === undefined) {
    apiKey = null;
  } else {
    apiKey = body.apiKey;
  }

  await db.setAppConfig({
    provider: body.provider as AppConfig['ai_provider'],
    model: body.model.trim(),
    baseUrl: body.baseUrl ?? null,
    apiKey,
  });

  // Invalidate the in-process AI cache so the next callAI uses the new config.
  clearAIConfigCache();

  // Re-read to return the masked response shape.
  return GET();
}