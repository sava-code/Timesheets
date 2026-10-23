/** Fonts offered for the table. Each falls back to similar fonts when not installed. */
export const TABLE_FONTS: Array<{ id: string; label: string; stack: string }> = [
  { id: "segoe", label: "Segoe UI / Arial (original)", stack: '"Segoe UI", Arial, sans-serif' },
  { id: "system", label: "System default", stack: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: "inter", label: "Inter", stack: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  { id: "helvetica", label: "Helvetica / Arial", stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: "roboto", label: "Roboto", stack: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
  { id: "verdana", label: "Verdana", stack: 'Verdana, Geneva, Tahoma, sans-serif' },
  { id: "georgia", label: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
  { id: "mono", label: "Monospace", stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' }
];

export const TABLE_FONT_SIZES = [11, 12, 13, 14, 15, 16, 17, 18, 20];

export function tableFontStack(id: string): string {
  return (TABLE_FONTS.find((font) => font.id === id) || TABLE_FONTS[0]).stack;
}
