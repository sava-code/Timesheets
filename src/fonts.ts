/**
 * Fonts offered for the table. "bundled" fonts ship with the app (see fonts.css), so they look the
 * same on every computer; the others use what the system has, with similar fallbacks.
 */
export const TABLE_FONTS: Array<{ id: string; label: string; stack: string }> = [
  // Segoe UI is built into Windows; elsewhere Microsoft's open-source look-alike Selawik is used (bundled).
  { id: "segoe", label: "Segoe UI", stack: '"Segoe UI", "Selawik", ui-sans-serif, system-ui, sans-serif' },
  { id: "system", label: "System default", stack: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: "arial", label: "Arial", stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { id: "inter", label: "Inter", stack: '"Inter", ui-sans-serif, system-ui, sans-serif' },
  { id: "fira-sans", label: "Fira Sans", stack: '"Fira Sans", ui-sans-serif, system-ui, sans-serif' },
  { id: "ibm-plex-sans", label: "IBM Plex Sans", stack: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif' },
  { id: "questrial", label: "Questrial", stack: '"Questrial", ui-sans-serif, system-ui, sans-serif' },
  { id: "helvetica", label: "Helvetica / Arial", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: "roboto", label: "Roboto", stack: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: "verdana", label: "Verdana", stack: 'Verdana, Geneva, Tahoma, sans-serif' },
  { id: "georgia", label: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
  { id: "mono", label: "Monospace", stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", stack: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace' },
  { id: "space-mono", label: "Space Mono", stack: '"Space Mono", ui-monospace, Menlo, Consolas, monospace' }
];

export const TABLE_FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 20];

export function tableFontStack(id: string): string {
  return (TABLE_FONTS.find((font) => font.id === id) || TABLE_FONTS[0]).stack;
}
