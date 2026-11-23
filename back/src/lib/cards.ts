/**
 * SVG cards for READMEs and profiles: a summary of all public repos and a card
 * per repo. Plain SVG with system fonts, so they render the same wherever an
 * image is allowed.
 */

export type CardTheme = 'auto' | 'light' | 'dark';
export const CARD_THEMES: CardTheme[] = ['auto', 'light', 'dark'];

export function cardTheme(value: string | undefined): CardTheme {
  return CARD_THEMES.includes(value as CardTheme) ? (value as CardTheme) : 'auto';
}

const PALETTES = {
  light: { bg: '#ffffff', border: '#d0d7de', title: '#0969da', text: '#1f2328', muted: '#59636e' },
  dark: { bg: '#0d1117', border: '#30363d', title: '#58a6ff', text: '#e6edf3', muted: '#9198a1' },
};

const rules = (p: typeof PALETTES.light) =>
  `.bg{fill:${p.bg};stroke:${p.border}}.title{fill:${p.title}}.text{fill:${p.text}}.muted{fill:${p.muted}}`;

/** `auto` follows the viewer's system theme through a media query inside the image. */
function styles(theme: CardTheme): string {
  const base = 'text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}';
  if (theme === 'auto') return `${base}${rules(PALETTES.light)}@media(prefers-color-scheme:dark){${rules(PALETTES.dark)}}`;
  return base + rules(PALETTES[theme]);
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Cuts `text` to about `max` characters on a word boundary. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function frame(width: number, height: number, theme: CardTheme, label: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}">
  <title>${escapeXml(label)}</title>
  <style>${styles(theme)}</style>
  <rect class="bg" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6"/>
${body}
</svg>`;
}

export interface Stat { label: string; value: string }

/** A titled grid of up to six figures, three per row. */
export function renderSummaryCard(title: string, stats: Stat[], theme: CardTheme = 'auto'): string {
  const shown = stats.slice(0, 6);
  const rows = Math.max(1, Math.ceil(shown.length / 3));
  const width = 480;
  const height = 62 + rows * 58;
  const cells = shown.map((stat, i) => {
    const x = 24 + (i % 3) * 152;
    const y = 82 + Math.floor(i / 3) * 58;
    return `  <text class="text" x="${x}" y="${y}" font-size="22" font-weight="600">${escapeXml(stat.value)}</text>
  <text class="muted" x="${x}" y="${y + 18}" font-size="12">${escapeXml(stat.label)}</text>`;
  });
  const label = `${title}: ${shown.map((stat) => `${stat.value} ${stat.label}`).join(', ')}`;
  return frame(width, height, theme, label, [
    `  <text class="title" x="24" y="38" font-size="16" font-weight="600">${escapeXml(truncate(title, 48))}</text>`,
    ...cells,
  ].join('\n'));
}

export interface RepoCardInput {
  fullName: string;
  description: string | null;
  language: string | null;
  languageColor: string | null;
  /** Short facts shown on the bottom line, e.g. "★ 412", "health 91/100". */
  facts: string[];
}

export function renderRepoCard(repo: RepoCardInput, theme: CardTheme = 'auto'): string {
  const description = truncate(repo.description?.trim() || 'No description', 64);
  const facts = [...(repo.language ? [repo.language] : []), ...repo.facts];
  const dot = repo.language
    ? `  <circle cx="30" cy="97" r="6" fill="${/^#[0-9a-f]{6}$/i.test(repo.languageColor ?? '') ? repo.languageColor : '#8b949e'}"/>\n`
    : '';
  const label = `${repo.fullName}: ${description}. ${facts.join(', ')}`;
  return frame(480, 124, theme, label, `  <text class="title" x="24" y="38" font-size="16" font-weight="600">${escapeXml(truncate(repo.fullName, 48))}</text>
  <text class="muted" x="24" y="64" font-size="13">${escapeXml(description)}</text>
${dot}  <text class="text" x="${repo.language ? 44 : 24}" y="101" font-size="12">${escapeXml(truncate(facts.join('   ·   '), 70))}</text>`);
}
