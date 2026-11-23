// Chart styling for recharts. Colors are the theme's CSS variables, so charts follow light and dark.
export const CHART_GRID_STROKE = 'var(--color-gray-200)';
export const CHART_TICK_FONT_SIZE = 12;

export const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'var(--surface)',
  border: '1px solid var(--color-gray-200)',
  borderRadius: '8px',
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
};

export const CHART_TOOLTIP_LABEL_STYLE = {
  color: 'var(--color-gray-900)',
};

export const CHART_LEGEND_STYLE = {
  color: 'var(--color-gray-700)',
};

export const chartTick = { fill: 'var(--color-gray-500)', fontSize: CHART_TICK_FONT_SIZE };
