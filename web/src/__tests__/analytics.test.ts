// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

type Row = IArguments | unknown[];
const fakeWindow = () => {
  const store: Record<string, string> = {};
  (globalThis as any).sessionStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
  (globalThis as any).window = {
    location: { search: "" },
    document: { readyState: "loading", getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } },
    addEventListener() {}, setTimeout() {},
  };
  return (globalThis as any).window as { dataLayer?: Row[] };
};
const rows = (win: { dataLayer?: Row[] }) => (win.dataLayer ?? []).map((r) => Array.from(r as ArrayLike<unknown>));

describe("analytics", () => {
  beforeEach(() => { (globalThis as any).window = undefined; });

  it("config leva content_group monitor_b3 (uma vez)", async () => {
    const win = fakeWindow();
    const a = await import("../analytics");
    a.initAnalytics(); a.initAnalytics();
    const cfg = rows(win).filter((r) => r[0] === "config");
    expect(cfg).toHaveLength(1);
    expect(cfg[0][1]).toBe(a.GA_MEASUREMENT_ID);
    expect((cfg[0][2] as any).content_group).toBe("monitor_b3");
  });

  it("outbound_click com link_type, link_url e link_text", async () => {
    const win = fakeWindow();
    const { trackOutbound } = await import("../analytics");
    trackOutbound("code", "https://github.com/celowiz/monitor-b3", "código");
    const ev = rows(win).find((r) => r[0] === "event")!;
    expect(ev[1]).toBe("outbound_click");
    expect(ev[2]).toMatchObject({ link_type: "code", link_url: "https://github.com/celowiz/monitor-b3", link_text: "código" });
  });
});
