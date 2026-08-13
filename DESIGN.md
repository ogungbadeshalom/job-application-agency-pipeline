# Job Bidder — Design System (DESIGN.md)

The design-system contract for the Job Bidder platform. Everything in the UI
should defer to this file so the product reads as one considered brand, not a
collection of one-off screens. Derived from the Open Design `redesign-skill`
audit while preserving the product's existing dark-engineering character.

## Brand
- **Product:** Job Bidder — a multi-tenant AI job-application agency dashboard.
- **Mood:** precise, technical, calm. A pro instrument for ops/candidates, not a
  consumer novelty. Dark by default (this is a daily-use dashboard).
- **Personality:** GitHub-dark meets modern tool. Data-first, quiet accents.

## Color

One hue-anchored dark palette + ONE accent. Keep saturation muted (< 80%) so the
UI reads calm; the accent is reserved for the primary action and the "NEW" pulse.

| Token   | Value     | Use |
|---------|-----------|-----|
| `ink`     | `#e6edf3` | primary text |
| `muted`   | `#8b949e` | secondary text, labels |
| `faint`   | `#6e7681` | tertiary, placeholders |
| `surface` | `#161b22` | cards / panels |
| `surface-2` | `#1c2128` | hover / raised rows |
| `chrome`  | `#21262d` | table rows |
| `line`    | `#30363d` | borders, dividers |
| `bg`      | `#0d1117` | page background (off-black navy) |
| **`accent`** | `#3fb950` | PRIMARY action, "NEW" status, active nav (single accent) |
| `accent-strong` | `#238636` | accent pressed/filled variant |
| `blue`  | `#58a6ff` | links / informational only (NOT a second action accent) |
| `warn`  | `#d29922` | pending / hybrid |
| `danger` | `#f85149` | destructive / error only |

Rules:
- **Never** use more than one accent at a time. `blue` is reserved for embedded
  hyperlinks, `warn`/`red` only for their semantic states.
- Do NOT soften the accent into pastel. Keep it at 60–80% saturation.

## 2. Typography

- **Font:** **Geist** (self-hosted via `next/font`) — a modern, characterful
  sans built for dense UI. Replace `system-ui/Roboto` from the old shell.
- **Monospace** for data (IDs, compensation, timestamps): `Geist Mono`.
- Use tabular numerals (`font-variant-numeric: tabular-nums`) on numeric/data
  columns so figures line up.

Type scale (tokens → Tailwind):
| Element | Size/Weight | Usage |
|---------|-------------|-------|
| display | 20–24px / 650 | page titles |
| title   | 15px / 600    | card headers, section heads |
| body    | 13–14px / 400 | default text, table cells |
| label   | 12px / 500    | inputs, muted captions |
| micro   | 11px / 500 uppercase, tracked | table headers (existing `.th`), badges |

Line: body 1.5, dense tables 1.4. Headings slightly tighter (1.15–1.25).
Use `text-wrap: balance` on headings.

## 3. Spacing & Radius

- **Space scale (Tailwind defaults):** 4/8/12/16/20/24/32.
- **Density rule:** data tables may be dense; everything else gets air
  (≥ 16px). No cramped two-panel layouts.
- **Radius:** 8px on containers, 6px inner controls, 4px chips/micro. Vary:
  tighter inside, softer outside. Buttons pill (`rounded-full`) only for CTAs.
- **Depth:** panels use a soft tinted shadow (matches bg hue) — `shadow` tokens
  below; never pure-black blur at low opacity.
- Stay within one tint family (cool navy) — no warm/cool gray mixing.

## 4. Component states

- **Interactive:** 200ms ease on background/color/transform.
- **Hover:** raised surface (`bg-surface-2`) + 1px border lighten; buttons:
  slight fill shift or `translateY(-1px)`.
- **Active/pressed:** `scale(0.98)` on buttons.
- **Focus:** visible 2px ring in accent at 50%** (a/keyboard).
- **Loading:** skeleton matching layout shape, not a spinner.
- **Empty/error:** composed empty-state text — no `alert()`.
- **NEW badge:** small accent dot + `NEW` micro-label (uppercase, tracked),
  gentle pulse on first appearance.

## 5. Sidebar / navigation

- Collapsed/expanded persisted rail (existing). Keep icons + label.
- **Active item:** subtle — `bg-accent/10` tint + left 3px accent bar; do NOT
  use a loud solid green box.
- Add a thin divider between main + settings groups.
- Muted, quiet hover.

## 6. Revision history

- 0.1 — Initial DESIGN.md contract (fonts/type/color/state/layout rules) from the
  redesign audit. Applied: typography, depth, states, sidebar active.