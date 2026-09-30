import { baselineGrowth } from "@qa/alignment";

const y = (keys: string[]) =>
  `baseline: 1\nentries:\n${keys.map((k) => `  - key: "${k}"\n    ids: [AUD-001]\n`).join("")}`;

describe("baselineGrowth", () => {
  it("detects added keys, sorted", () => {
    expect(baselineGrowth(y(["A:a:x"]), y(["A:a:x", "C:c:z", "B:b:y"]))).toEqual(["B:b:y", "C:c:z"]);
  });
  it("ignores removed keys", () => {
    expect(baselineGrowth(y(["A:a:x", "B:b:y"]), y(["A:a:x"]))).toEqual([]);
  });
  it("returns [] when identical", () => {
    expect(baselineGrowth(y(["A:a:x"]), y(["A:a:x"]))).toEqual([]);
  });
  it("returns [] when base is null", () => {
    expect(baselineGrowth(null, y(["A:a:x"]))).toEqual([]);
  });
  it("throws on invalid YAML", () => {
    expect(() => baselineGrowth(y([]), "baseline: [unclosed")).toThrow();
  });
});
