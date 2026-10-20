import { afterEach, describe, expect, it, vi } from "vitest";
import { adminEmail, isAdmin, isEmail } from "../src/lib/access";

afterEach(() => vi.unstubAllEnvs());

describe("access", () => {
  it("uses ADMIN_EMAIL, falling back to the old ALLOWED_EMAIL", () => {
    vi.stubEnv("ADMIN_EMAIL", "");
    vi.stubEnv("ALLOWED_EMAIL", " Me@Example.com ");
    expect(adminEmail()).toBe("me@example.com");
    vi.stubEnv("ADMIN_EMAIL", "boss@example.com");
    expect(adminEmail()).toBe("boss@example.com");
  });

  it("recognises the admin case-insensitively and nobody when unset", () => {
    vi.stubEnv("ADMIN_EMAIL", "me@example.com");
    expect(isAdmin("ME@example.com")).toBe(true);
    expect(isAdmin("friend@example.com")).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    vi.stubEnv("ADMIN_EMAIL", "");
    vi.stubEnv("ALLOWED_EMAIL", "");
    expect(isAdmin("me@example.com")).toBe(false);
  });

  it("checks email shape", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("not an email")).toBe(false);
  });
});
