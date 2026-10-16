import { describe, it, expect } from "vitest";
import { layout } from "../Canvas";
import { defaultScreen, isFilter } from "../engine";
import { PRESETS } from "../presets";

describe("layout do canvas", () => {
  const screens = [defaultScreen(), ...PRESETS.map((p) => p.build(5_000_000))];
  it("põe todos os sinais numa coluna só, sem nós sobrepostos", () => {
    for (const s of screens) {
      const { pos } = layout(s.blocks);
      const sigs = s.blocks.filter((b) => !isFilter(b.type)).map((b) => pos.get(b.id)!);
      expect(new Set(sigs.map((p) => p.x)).size).toBeLessThanOrEqual(1);
      expect(new Set(sigs.map((p) => p.y)).size).toBe(sigs.length);
    }
  });
});
