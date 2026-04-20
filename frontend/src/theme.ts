export const COLORS = {
  // Backgrounds — sidebar is DARKER than main to create depth/hierarchy.
  bg: '#1a1a1c',
  bgSidebar: '#131315',
  bgCard: '#242428',
  bgCardHover: '#2d2d31',
  bgInput: '#242428',
  bgElevated: '#2a2a2e',

  // Borders
  border: '#2a2a2e',
  borderStrong: '#3a3a3f',
  borderSubtle: '#1f1f22',

  // Text
  text: '#ededef',
  textMuted: '#9a9aa0',
  textDim: '#666670',

  // Accents
  blue: '#5c9cf6',
  blueDim: '#2a4a7c',
  green: '#22c55e',
  orange: '#f59e0b',
  red: '#ef4444',
  amber: '#d97706',
  purple: '#a78bfa',

  // Semantic
  userBubble: '#2c507f',
  userBubbleText: '#e4eeff',
  codeBg: '#2d2d32',
  codeText: '#e8e8ea',

  // Shadows
  shadowCard: '0 1px 2px rgba(0,0,0,0.3), 0 6px 16px rgba(0,0,0,0.25)',
  shadowFloat: '0 10px 40px rgba(0,0,0,0.45)',
}

export const FONTS = {
  body: '-apple-system, BlinkMacSystemFont, Inter, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
}

// Per-provider accent color used for message-attribution borders, the
// active-session indicator in the sidebar, and the status pill. Falls
// back to ``blue`` for unknown kinds so new providers stay visible
// without requiring a theme update.
export const PROVIDER_ACCENT: Record<string, string> = {
  claude: COLORS.purple,
  openai: COLORS.green,
  gemini: COLORS.blue,
  ollama: COLORS.orange,
}

export function providerAccent(kind: string): string {
  return PROVIDER_ACCENT[kind] ?? COLORS.blue
}
