export function parseNumericFromText(text: string): number | null {
  // Grab something that looks like a number (optionally with decimals and commas)
  const match = text.replace(/\s+/g, " ").match(/-?\d[\d,]*(\.\d+)?/);
  if (!match) return null;

  const cleaned = match[0].replace(/,/g, "");
  const value = Number(cleaned);
  return Number.isNaN(value) ? null : value;
}
