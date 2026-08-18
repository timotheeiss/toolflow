import { describe, expect, it } from "vitest";
import { accessibleForeground, contrastRatio } from "./branding.js";

describe("branding contrast", () => {
  it.each(["#000000", "#FFFFFF", "#214D3B", "#F7E7A1", "#2563EB"])(
    "selects an AA foreground for %s",
    (background) => {
      const foreground = accessibleForeground(background);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("uses dark text for light branding and light text for dark branding", () => {
    expect(accessibleForeground("#FFFFFF")).toBe("#000000");
    expect(accessibleForeground("#000000")).toBe("#FFFFFF");
  });

  it("rejects malformed colors", () => {
    expect(() => accessibleForeground("white")).toThrow("six-digit hexadecimal");
  });
});
