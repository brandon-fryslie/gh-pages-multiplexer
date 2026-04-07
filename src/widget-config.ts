// [LAW:one-source-of-truth] Widget customization defaults and validation live in one
//   place. Both adapters (Action / CLI) call into here so the validation rules and
//   default values are not duplicated.
// [LAW:single-enforcer] Position-string parsing is the sole place that knows the
//   "<edge> <vertical%>" syntax. Downstream consumers (widget-injector) only see the
//   parsed { edge, vertical } shape.

/** Built-in default layers icon (Lucide). Used when widgetIcon is empty. */
export const DEFAULT_WIDGET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>';

export const DEFAULT_WIDGET_LABEL = '{version}';
export const DEFAULT_WIDGET_POSITION = 'right 80%';
export const DEFAULT_WIDGET_COLOR = '#f97316';

export interface WidgetPosition {
  edge: 'right' | 'left';
  vertical: string; // CSS-ready percentage like "80%"
}

/**
 * Parse a "<edge> <vertical%>" string into structured form. Throws on invalid input
 * with a clear message naming the offending value.
 *
 * Empty input is interpreted as the default ("right 80%").
 */
export function parseWidgetPosition(raw: string): WidgetPosition {
  const value = (raw || '').trim() || DEFAULT_WIDGET_POSITION;
  const parts = value.split(/\s+/);
  if (parts.length !== 2) {
    throw new Error(
      `Invalid widget-position "${raw}": expected "<edge> <vertical%>" (e.g. "right 80%")`,
    );
  }
  const [edgeRaw, verticalRaw] = parts;
  if (edgeRaw !== 'right' && edgeRaw !== 'left') {
    throw new Error(
      `Invalid widget-position edge "${edgeRaw}": must be "right" or "left"`,
    );
  }
  if (!/^\d{1,3}%$/.test(verticalRaw)) {
    throw new Error(
      `Invalid widget-position vertical "${verticalRaw}": must be a percentage like "80%"`,
    );
  }
  const pct = parseInt(verticalRaw, 10);
  if (pct < 0 || pct > 100) {
    throw new Error(
      `Invalid widget-position vertical "${verticalRaw}": must be between 0% and 100%`,
    );
  }
  return { edge: edgeRaw, vertical: verticalRaw };
}

/**
 * Validate a hex color string. Accepts #rgb, #rrggbb, or #rrggbbaa. Empty string
 * is allowed (caller substitutes the default). Throws on anything else.
 */
export function validateWidgetColor(raw: string): string {
  const value = (raw || '').trim();
  if (value === '') return value;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    throw new Error(
      `Invalid widget-color "${raw}": must be a hex color like "#f97316" or "#fff"`,
    );
  }
  return value;
}
