export const TEMPLATE_CATEGORY_BADGE_COLORS: Record<string, { text: string; bg: string }> = {
  'landing-page': { text: '#22d3ee', bg: 'rgba(34, 211, 238, 0.12)' },
  portfolio: { text: '#818cf8', bg: 'rgba(129, 140, 248, 0.12)' },
  'online-store': { text: '#4ade80', bg: 'rgba(74, 222, 128, 0.12)' },
  dashboard: { text: '#fb923c', bg: 'rgba(251, 146, 60, 0.12)' },
  saas: { text: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)' },
  'ai-app': { text: '#f472b6', bg: 'rgba(244, 114, 182, 0.12)' },
};

export const TEMPLATE_UI_COLORS = {
  pageBg: '#0a0a0a',
  cardBg: '#1a1a1a',
  cardBgAlt: '#141414',
  border: '#333333',
  borderHover: '#555555',
  textMuted: '#9ca3af',
  textSubtle: '#666',
  primary: '#3b82f6',
  primaryHover: '#2563eb',
} as const;
