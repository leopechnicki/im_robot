export interface ThemeColors {
  bg: string
  border: string
  text: string
  textMuted: string
  codeBg: string
  inputBorder: string
  inputBg: string
  btnBg: string
  btnHover: string
  successColor: string
  errorColor: string
}

const light: ThemeColors = {
  bg: '#fafafa',
  border: '#d0d0d0',
  text: '#1a1a1a',
  textMuted: '#888',
  codeBg: '#f0f0f0',
  inputBorder: '#ccc',
  inputBg: '#fff',
  btnBg: '#2563eb',
  btnHover: '#1d4ed8',
  successColor: '#16a34a',
  errorColor: '#dc2626',
}

const dark: ThemeColors = {
  bg: '#1a1a2e',
  border: '#333355',
  text: '#e0e0e0',
  textMuted: '#8888aa',
  codeBg: '#16213e',
  inputBorder: '#444466',
  inputBg: '#0f0f23',
  btnBg: '#3b82f6',
  btnHover: '#2563eb',
  successColor: '#22c55e',
  errorColor: '#ef4444',
}

export function getTheme(theme: 'light' | 'dark'): ThemeColors {
  return theme === 'dark' ? dark : light
}

export type WidgetSize = 'compact' | 'standard'

export function getStyles(theme: 'light' | 'dark', size?: WidgetSize): string {
  const t = getTheme(theme)
  return `
    .imrobot {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      border: 2px solid ${t.border};
      border-radius: 10px;
      padding: 20px;
      max-width: 420px;
      background: ${t.bg};
      color: ${t.text};
      box-sizing: border-box;
    }
    .imrobot *,
    .imrobot *::before,
    .imrobot *::after {
      box-sizing: border-box;
    }
    .imrobot-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
      font-size: 16px;
      font-weight: 700;
    }
    .imrobot-icon {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      line-height: 1;
    }
    .imrobot-challenge {
      background: ${t.codeBg};
      border-radius: 6px;
      padding: 14px;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
      font-size: 12px;
      line-height: 1.6;
      margin-bottom: 14px;
      white-space: pre-wrap;
      word-break: break-all;
      color: ${t.text};
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      position: relative;
      filter: blur(8px);
      transition: filter 0.15s ease-out;
    }
    .imrobot-challenge:hover {
      filter: none;
    }
    .imrobot-challenge--shielded,
    .imrobot-challenge--shielded:hover {
      filter: blur(10px) !important;
    }
    .imrobot-shield-notice {
      display: flex;
      position: absolute;
      inset: 0;
      border-radius: 6px;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 600;
      color: ${t.textMuted};
      z-index: 1;
      pointer-events: none;
      letter-spacing: 0.03em;
    }
    .imrobot-challenge:hover .imrobot-shield-notice {
      display: none;
    }
    .imrobot-challenge--shielded .imrobot-shield-notice,
    .imrobot-challenge--shielded:hover .imrobot-shield-notice {
      display: flex !important;
    }
    .imrobot-timer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      font-size: 12px;
      font-weight: 600;
    }
    .imrobot-timer-label {
      color: ${t.textMuted};
    }
    .imrobot-timer-bar {
      flex: 1;
      height: 4px;
      background: ${t.codeBg};
      border-radius: 2px;
      margin: 0 10px;
      overflow: hidden;
    }
    .imrobot-timer-fill {
      height: 100%;
      background: ${t.btnBg};
      border-radius: 2px;
      transition: width 1s linear;
    }
    .imrobot-timer-fill--warn {
      background: ${t.errorColor};
    }
    .imrobot-timer-text {
      color: ${t.textMuted};
      font-variant-numeric: tabular-nums;
      min-width: 28px;
      text-align: right;
    }
    .imrobot-row {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .imrobot-input {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid ${t.inputBorder};
      border-radius: 6px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      background: ${t.inputBg};
      color: ${t.text};
      outline: none;
      transition: border-color 0.15s;
    }
    .imrobot-input:focus {
      border-color: ${t.btnBg};
    }
    .imrobot-btn {
      padding: 10px 20px;
      background: ${t.btnBg};
      color: #fff;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 13px;
      transition: background 0.15s;
      white-space: nowrap;
    }
    .imrobot-btn:hover {
      background: ${t.btnHover};
    }
    .imrobot-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .imrobot-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: ${t.textMuted};
    }
    .imrobot-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 13px;
    }
    .imrobot-status--verified {
      color: ${t.successColor};
    }
    .imrobot-status--failed {
      color: ${t.errorColor};
    }
    .imrobot-brand {
      font-size: 11px;
      color: ${t.textMuted};
      text-decoration: none;
    }
    ${
      size === 'compact'
        ? `
    /* ── Compact mode overrides ── */
    .imrobot {
      padding: 12px;
      max-width: 320px;
      border-radius: 8px;
    }
    .imrobot-header {
      gap: 6px;
      margin-bottom: 10px;
      font-size: 13px;
    }
    .imrobot-icon {
      width: 20px;
      height: 20px;
      font-size: 16px;
    }
    .imrobot-icon svg {
      width: 20px;
      height: 20px;
    }
    .imrobot-challenge {
      padding: 8px 10px;
      font-size: 10px;
      line-height: 1.5;
      margin-bottom: 8px;
      max-height: 100px;
      overflow-y: auto;
    }
    .imrobot-timer {
      margin-bottom: 6px;
      font-size: 10px;
    }
    .imrobot-row {
      gap: 6px;
      margin-bottom: 8px;
    }
    .imrobot-input {
      padding: 6px 8px;
      font-size: 11px;
      border-radius: 4px;
    }
    .imrobot-btn {
      padding: 6px 12px;
      font-size: 11px;
      border-radius: 4px;
    }
    .imrobot-footer {
      font-size: 9px;
    }
    .imrobot-status {
      font-size: 11px;
      gap: 4px;
    }
    .imrobot-brand {
      font-size: 9px;
    }
    `
        : ''
    }
  `
}

export const ROBOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/><path d="M10 18h4"/></svg>`
