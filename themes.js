export const THEME_IDS = ['default', 'pink', 'blue'];

export const CUSTOM_COLOR_KEYS = [
    'panel-background',
    'panel-text',
    'highlight-background',
    'highlight-text',
];

export function isCustomColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value);
}
