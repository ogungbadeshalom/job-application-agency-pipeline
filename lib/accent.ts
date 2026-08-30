// Single source of truth for the app's accent color themes.
//
// These values are used by:
//   - globals.css        html[data-accent="<value>"] blocks
//   - AccentSetting.tsx  the Appearance row in admin Settings
//   - AccentSwatches.tsx the per-user picker in the shared nav shell
//   - app/api/me/accent  server-side validation
//   - app/layout.tsx     pre-paint script (kept in sync manually)
//
// `''` = the app default (GREEN, the :root value in globals.css). When a user
// picks a non-default color we set data-accent="<value>" on <html>; for the
// default we REMOVE the attribute so globals.css :root wins.

export const ACCENTS = [
  { value: 'green', label: 'Green', color: '#3fb950' },
  { value: 'red', label: 'Red', color: '#f85149' },
  { value: 'blue', label: 'Blue', color: '#58a6ff' },
  { value: 'purple', label: 'Purple', color: '#bc8cff' },
  { value: 'orange', label: 'Orange', color: '#f0883e' },
  { value: 'cyan', label: 'Cyan', color: '#39c5cf' },
] as const;

export type AccentValue = (typeof ACCENTS)[number]['value'];

/** The default accent: '' renders as the globals.css :root value (GREEN). */
export const DEFAULT_ACCENT = 'green';
export const DEFAULT_ACCENT_VALUE = '' as const;

export const STORAGE_KEY = 'jobbidder.accent';

export function isAccentValue(v: string | null): v is AccentValue {
  return ACCENTS.some((a) => a.value === v);
}

/**
 * Resolve any string to a valid accent value. '' (default) maps to the default,
 * unknown strings fall back to '' (GREEN). Returns a value safe to assign to the
 * DOM `data-accent` attribute / store on the user row.
 */
export function normalizeAccent(v: string | null | undefined): string {
  if (v && isAccentValue(v)) return v;
  return DEFAULT_ACCENT_VALUE;
}

/** Apply an accent to the DOM. Pass '' to reset to the default (GREEN). */
export function applyAccent(accent: string) {
  const value = normalizeAccent(accent);
  if (value === DEFAULT_ACCENT_VALUE) {
    document.documentElement.removeAttribute('data-accent');
  } else {
    document.documentElement.setAttribute('data-accent', value);
  }
}

/** The display color for a resolved accent value (for swatches). */
export function accentColor(accent: string): string {
  return ACCENTS.find((a) => a.value === accent)?.color ?? ACCENTS[0].color;
}