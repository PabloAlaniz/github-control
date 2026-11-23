/** Renders a small two-part SVG badge ("label | value"), the kind used in READMEs. */

const COLORS: Record<string, string> = {
  blue: '#2563eb',
  green: '#16a34a',
  yellow: '#ca8a04',
  red: '#dc2626',
  gray: '#6b7280',
};

/** Approximate width of text set in 11px Verdana; good enough to size the badge. */
function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    if ('il.,:;|!\'1 '.includes(ch)) width += 4;
    else if ('mwMW%'.includes(ch)) width += 10;
    else if (ch >= 'A' && ch <= 'Z') width += 8;
    else width += 6.5;
  }
  return Math.ceil(width);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 1234 -> "1.2k", 1_500_000 -> "1.5M". */
export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(value);
}

export type BadgeStyle = 'flat' | 'flat-square';

export function renderBadge(
  label: string, value: string, color: keyof typeof COLORS | string = 'blue', style: BadgeStyle = 'flat',
): string {
  const left = textWidth(label) + 12;
  const right = textWidth(value) + 12;
  const width = left + right;
  const fill = COLORS[color] ?? COLORS.blue;
  const safeLabel = escapeXml(label);
  const safeValue = escapeXml(value);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${safeLabel}: ${safeValue}">
  <title>${safeLabel}: ${safeValue}</title>
  <clipPath id="r"><rect width="${width}" height="20" rx="${style === 'flat-square' ? 0 : 3}"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${left}" height="20" fill="#4b5563"/>
    <rect x="${left}" width="${right}" height="20" fill="${fill}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${left / 2}" y="14">${safeLabel}</text>
    <text x="${left + right / 2}" y="14">${safeValue}</text>
  </g>
</svg>`;
}
