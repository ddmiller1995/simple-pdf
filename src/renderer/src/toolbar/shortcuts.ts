const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

/** Platform-appropriate shortcut text, e.g. `shortcut('S')` is "⌘S" on macOS, "Ctrl+S" elsewhere. */
export const shortcut = (key: string): string => (isMac ? `⌘${key}` : `Ctrl+${key}`);

/** Tooltip text with the shortcut appended: `tip('Save', shortcut('S'))` -> "Save (⌘S)". */
export const tip = (label: string, keys?: string): string => (keys ? `${label} (${keys})` : label);
