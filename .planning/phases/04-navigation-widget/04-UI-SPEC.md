# Phase 4: Navigation Widget — UI Design Contract

**Approved:** 2026-04-06 (--auto)
**Status:** Locked

## Pillar 1: Layout & Anchoring

- Widget is a single custom element `<gh-pm-nav>` injected into every deployed HTML page before `</body>`.
- Floating button: `position: fixed; bottom: 16px; right: 16px; z-index: 2147483647`.
- Button: `40px × 40px` circle, hamburger icon (3 horizontal SVG lines), subtle box-shadow.
- Click toggles a panel: appears anchored above the button (`bottom: 64px; right: 16px`), `width: 240px`, `max-height: 60vh`, scrollable internally if content overflows.
- Panel slides in via `transform: translateY(8px) → translateY(0)` and `opacity: 0 → 1` over 120ms ease-out. Closing reverses with the same timing.
- Mobile (≤600px): button stays at `bottom: 16px; right: 16px`. Panel widens to `calc(100vw - 32px)` and anchors `right: 16px` so it doesn't overflow the viewport.

## Pillar 2: Spacing & Sizing

| Token | Value |
|-------|-------|
| Button size | `40px × 40px` |
| Button radius | `50%` |
| Button shadow | `0 2px 8px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)` |
| Panel padding | `12px` |
| Panel radius | `12px` |
| Panel shadow | `0 8px 24px rgba(0,0,0,0.18)` |
| Row padding | `8px 12px` |
| Row gap | `2px` |
| Heading font size | `13px` |
| Body font size | `13px` |
| Mono font size | `12px` |
| Line height | `1.4` |
| Slide distance | `8px` |
| Slide duration | `120ms` |
| Easing | `cubic-bezier(0.2, 0.8, 0.2, 1)` |

## Pillar 3: Typography

- **Sans stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Mono stack:** `ui-monospace, "SF Mono", Menlo, Consolas, monospace`
- Both stacks set inside Shadow DOM via `<style>` so they cannot inherit from the host page.
- No web fonts.

## Pillar 4: Color (Shadow DOM scoped)

Mirrors Phase 3 palette so widget + index feel cohesive.

Light:

| Token | Value |
|-------|-------|
| `--widget-bg` | `#ffffff` |
| `--widget-bg-hover` | `#f6f8fa` |
| `--widget-fg` | `#1f2328` |
| `--widget-fg-muted` | `#656d76` |
| `--widget-border` | `#d0d7de` |
| `--widget-accent` | `#0969da` |
| `--widget-accent-hover` | `#0550ae` |
| `--widget-current-bg` | `#ddf4ff` |

Dark (`prefers-color-scheme: dark`):

| Token | Value |
|-------|-------|
| `--widget-bg` | `#161b22` |
| `--widget-bg-hover` | `#21262d` |
| `--widget-fg` | `#e6edf3` |
| `--widget-fg-muted` | `#8d96a0` |
| `--widget-border` | `#30363d` |
| `--widget-accent` | `#2f81f7` |
| `--widget-accent-hover` | `#539bf5` |
| `--widget-current-bg` | `#0c2d6b` |

## Pillar 5: Copywriting

| String | Locked text |
|--------|------------|
| Button `aria-label` | `Switch version` |
| Panel header | `Versions` |
| Index link | `← Index` |
| Loading state | `Loading versions…` |
| Error state | `Could not load versions` |
| Current version badge text | `current` |
| Row format | `{version}` (line 1, sans bold), `{ref}` (line 2, mono small muted) |

## Pillar 6: Accessibility & Interaction

- Button is a real `<button>` element with `aria-label="Switch version"`, `aria-expanded` toggled true/false, `aria-controls` pointing to panel id.
- Panel is `role="dialog"` with `aria-label="Versions"`.
- Open via mouse click or `Enter`/`Space` on focused button.
- Close via:
  - Click on the button again
  - `Escape` key when panel has focus
  - Click outside the widget Shadow root (caught via `composedPath()` check on document click — single listener attached only while panel is open, removed on close, no leak).
- Focus management: when panel opens, first focusable item (current version row or first link) receives focus. When panel closes, focus returns to the toggle button.
- All rows are reachable via Tab. Visible focus ring: `outline: 2px solid var(--widget-accent); outline-offset: 2px`.
- Color contrast: text vs background ≥ 4.5:1 in both themes.
- Widget is hidden if JS disabled — graceful degradation. The host page works fine without the widget.

## Verification gates

- [ ] Marker comment present in injected HTML, idempotent on re-deploy
- [ ] Shadow DOM is `mode: 'open'`, no global styles emitted
- [ ] No event listeners attached to `document` or `window` outside the open panel lifecycle
- [ ] Widget script defines no global variables (use IIFE / `const customElement = class extends HTMLElement {...}`)
- [ ] Widget uses no external network resources at injection time (only the runtime fetch of `versions.json` after user interaction)
- [ ] Browser-verified: button visible, click opens panel, fetches manifest, navigates correctly, no host CSS interference (test against pages with aggressive CSS resets)

---

*Phase: 04-navigation-widget*
*UI-SPEC approved: 2026-04-06*
