import { describe, it, expect } from "vitest";
import { slugify } from "@/utils/slugify";

describe("slugify", () => {
  it("lowercases and joins words with underscores", () => {
    expect(slugify("Web Search")).toBe("web_search");
    expect(slugify("Current Time")).toBe("current_time");
  });

  it("collapses runs of non-alphanumerics and trims edges", () => {
    expect(slugify("  My  Cool--Tool!! ")).toBe("my_cool_tool");
    expect(slugify("@@@hello@@@")).toBe("hello");
  });

  it("falls back to 'tool' when empty after stripping", () => {
    expect(slugify("")).toBe("tool");
    expect(slugify("!!!")).toBe("tool");
  });
});
