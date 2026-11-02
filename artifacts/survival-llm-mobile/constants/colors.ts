/**
 * Survival LLM design tokens — the exact palette of the desktop app
 * (app/static/app.css at the workspace root), light and dark.
 * The desktop UI is deliberately plain and utilitarian: warm paper background,
 * amber accent, system-ui type. This file mirrors it 1:1.
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#1d1c1a',
    tint: '#8f5400',

    // Core surfaces
    background: '#f7f6f3', // --bg
    foreground: '#1d1c1a', // --text

    // Cards / elevated surfaces
    card: '#ffffff', // --panel
    cardForeground: '#1d1c1a',

    // Primary action color (the desktop --accent)
    primary: '#8f5400',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#efe9dd', // --user bubble
    secondaryForeground: '#1d1c1a',

    // Muted / subdued elements
    muted: '#f7f6f3',
    mutedForeground: '#6b6963', // --muted

    // Accent highlights (badges, selected items, focus rings)
    accent: '#fff1c7', // --cite
    accentForeground: '#1d1c1a',

    // Destructive actions
    destructive: '#b3261e', // --danger
    destructiveForeground: '#ffffff',

    // Borders
    border: '#e3e1db', // --line
    input: '#e3e1db',

    // Survival LLM extras (used across the chat UI)
    cite: '#fff1c7',
    citeLine: '#e5b84a',
    userBubble: '#efe9dd',
    ok: '#2e7d4a',
    statusOn: '#3a9d5d',
    statusOff: '#c0392b',
    statusWarn: '#d48a00',
    official: '#1e6b3d',
  },

  dark: {
    text: '#ecebe6',
    tint: '#f0b54a',

    background: '#151412',
    foreground: '#ecebe6',

    card: '#1e1d1a',
    cardForeground: '#ecebe6',

    primary: '#f0b54a',
    primaryForeground: '#1d1405',

    secondary: '#2a2620',
    secondaryForeground: '#ecebe6',

    muted: '#151412',
    mutedForeground: '#a3a097',

    accent: '#3a311c',
    accentForeground: '#ecebe6',

    destructive: '#f2b8b5',
    destructiveForeground: '#1d1405',

    border: '#2f2d29',
    input: '#2f2d29',

    cite: '#3a311c',
    citeLine: '#b88a2a',
    userBubble: '#2a2620',
    ok: '#2e7d4a',
    statusOn: '#3a9d5d',
    statusOff: '#c0392b',
    statusWarn: '#d48a00',
    official: '#8fd6a8',
  },

  // Desktop radii: 10-14px on bubbles/cards, 8px on inputs.
  radius: 12,
};

export default colors;
