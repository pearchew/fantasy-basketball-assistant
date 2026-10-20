// Colour theme chosen by hand. No cookie means follow the device setting. Stored in a
// cookie so the server renders the right theme on the first paint.
export const THEME_COOKIE = "theme";

export type Theme = "light" | "dark";

export function themeFrom(cookies: { get(name: string): { value: string } | undefined }): Theme | undefined {
  const raw = cookies.get(THEME_COOKIE)?.value;
  return raw === "light" || raw === "dark" ? raw : undefined;
}
