import { describe, it, expect } from "vitest";
import { getConnectionBehavior } from "@/engine/connectivity";

describe("connectivity: Chat ↔ Agent", () => {
  it("defaults to bi-directional and is toggleable (like Chat ↔ LLM)", () => {
    const r = getConnectionBehavior("chat", "agent");
    expect(r.allowedOption).toBe("both");
    expect(r.defaultFlow).toBe("bi-directional");
  });

  it("leaves unregistered agent pairs one-way", () => {
    const r = getConnectionBehavior("agent", "notify");
    expect(r.allowedOption).toBe("one-way");
    expect(r.defaultFlow).toBe("one-way");
  });
});
