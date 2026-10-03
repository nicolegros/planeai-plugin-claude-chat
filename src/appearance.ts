/** The chat's fonts, stored in PlaneAI's settings for this plugin; a missing field is PlaneAI's default. */
export interface Appearance {
  font_family?: string;
  code_font_family?: string;
  /** Base text size in px; the chat's other sizes are derived from it. */
  font_size?: number;
}

export const FONT_SIZE = { min: 10, max: 24, default: 13 };

/** Each name is written as a quoted CSS string, so quotes, escapes, declaration and tag delimiters, and control characters are refused. */
export const FONT_FAMILY = { maxLength: 200, forbidden: /["'\\;{}<>\u0000-\u001f\u007f]/ };

const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji"]);

/** The names in a comma-separated family list, without their quotes; `null` when one cannot be used. */
function familyNames(value: string): string[] | null {
  const names = value
    .split(",")
    .map((name) => name.trim().replace(/^(["'])(.*)\1$/, "$2").trim())
    .filter(Boolean);
  return names.some((name) => FONT_FAMILY.forbidden.test(name)) ? null : names;
}

/** A family list as CSS: each name a quoted string except generic families, which are keywords. */
function cssFamily(value: string): string {
  return (familyNames(value) ?? []).map((name) => (GENERIC_FAMILIES.has(name.toLowerCase()) ? name : `"${name}"`)).join(", ");
}

/** Why a font name cannot be used, or `null` when it can (an empty name means PlaneAI's font). */
export function familyProblem(value: string): string | null {
  if (value.trim().length > FONT_FAMILY.maxLength) return `Font names are at most ${FONT_FAMILY.maxLength} characters.`;
  const names = familyNames(value);
  if (!names) return "Font names cannot contain ; { } < > \\, quotes (except around a whole name) or control characters.";
  return names.length > 0 || !value.trim() ? null : "Enter a font name, or leave the field empty.";
}

function family(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && familyProblem(trimmed) === null ? trimmed : undefined;
}

export function validSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= FONT_SIZE.min && value <= FONT_SIZE.max;
}

/** The valid fields of stored or received settings. */
export function normalizeAppearance(value: unknown): Appearance {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const fields = value as Record<string, unknown>;
  const fontFamily = family(fields.font_family);
  const codeFontFamily = family(fields.code_font_family);
  return {
    ...(fontFamily ? { font_family: fontFamily } : {}),
    ...(codeFontFamily ? { code_font_family: codeFontFamily } : {}),
    ...(validSize(fields.font_size) ? { font_size: fields.font_size } : {}),
  };
}

/** Inline style for a root element: the fonts, with PlaneAI's as fallbacks for missing ones, the base size, and how much it scales the default spacing. */
export function appearanceStyle(appearance: Appearance): string {
  return [
    `--chat-font: ${appearance.font_family ? `${cssFamily(appearance.font_family)}, ` : ""}var(--planeai-font-sans)`,
    `--chat-code-font: ${appearance.code_font_family ? `${cssFamily(appearance.code_font_family)}, ` : ""}var(--planeai-font-mono)`,
    `--chat-size: ${appearance.font_size ?? FONT_SIZE.default}px`,
    `--chat-scale: ${(appearance.font_size ?? FONT_SIZE.default) / FONT_SIZE.default}`,
  ].join("; ");
}
