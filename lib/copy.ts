'use client';

// Reliable copy-to-clipboard. `navigator.clipboard.writeText` only works in a
// secure context AND when the document is focused — over a tunnel/HTTP or when
// the page isn't focused it throws silently and the button "does nothing".
// Fall back to a hidden textarea + execCommand('copy'), which works everywhere.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}