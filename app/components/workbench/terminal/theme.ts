import type { ITheme } from '@xterm/xterm';

const style = getComputedStyle(document.documentElement);
const cssVar = (token: string) => style.getPropertyValue(token) || undefined;

export function getTerminalTheme(overrides?: ITheme): ITheme {
  return {
    cursor: cssVar('--devonz-elements-terminal-cursorColor'),
    cursorAccent: cssVar('--devonz-elements-terminal-cursorColorAccent'),
    foreground: cssVar('--devonz-elements-terminal-textColor'),
    background: cssVar('--devonz-elements-terminal-backgroundColor'),
    selectionBackground: cssVar('--devonz-elements-terminal-selection-backgroundColor'),
    selectionForeground: cssVar('--devonz-elements-terminal-selection-textColor'),
    selectionInactiveBackground: cssVar('--devonz-elements-terminal-selection-backgroundColorInactive'),

    // ansi escape code colors
    black: cssVar('--devonz-elements-terminal-color-black'),
    red: cssVar('--devonz-elements-terminal-color-red'),
    green: cssVar('--devonz-elements-terminal-color-green'),
    yellow: cssVar('--devonz-elements-terminal-color-yellow'),
    blue: cssVar('--devonz-elements-terminal-color-blue'),
    magenta: cssVar('--devonz-elements-terminal-color-magenta'),
    cyan: cssVar('--devonz-elements-terminal-color-cyan'),
    white: cssVar('--devonz-elements-terminal-color-white'),
    brightBlack: cssVar('--devonz-elements-terminal-color-brightBlack'),
    brightRed: cssVar('--devonz-elements-terminal-color-brightRed'),
    brightGreen: cssVar('--devonz-elements-terminal-color-brightGreen'),
    brightYellow: cssVar('--devonz-elements-terminal-color-brightYellow'),
    brightBlue: cssVar('--devonz-elements-terminal-color-brightBlue'),
    brightMagenta: cssVar('--devonz-elements-terminal-color-brightMagenta'),
    brightCyan: cssVar('--devonz-elements-terminal-color-brightCyan'),
    brightWhite: cssVar('--devonz-elements-terminal-color-brightWhite'),

    ...overrides,
  };
}
