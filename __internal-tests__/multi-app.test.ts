import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAppsConfig,
  resolveApp,
  resolveApps,
  resolveAppUrl,
  isSingleAppMode,
  validateAppsExist,
  buildSsoUrl,
  multiAppCycleLabel,
} from "@qa/multi-app";

function makeFixture(configContents: object): { dir: string; cfg: string } {
  const dir = mkdtempSync(join(tmpdir(), "aegis-multiapp-"));
  const cfg = join(dir, "aegis.config.json");
  writeFileSync(cfg, JSON.stringify(configContents, null, 2), "utf-8");
  return { dir, cfg };
}

describe("multi-app — loadAppsConfig", () => {
  it("returns single-app mode when target.apps is missing", () => {
    const { dir, cfg } = makeFixture({ targetProjectRoot: ".." });
    try {
      const loaded = loadAppsConfig(cfg);
      expect(loaded.apps).toEqual([]);
      expect(isSingleAppMode(loaded)).toBe(true);
      expect(loaded.targetProjectRoot).toBe("..");
      expect(loaded.configDir).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns single-app mode when target.apps is an empty array", () => {
    const { dir, cfg } = makeFixture({ target: { platform: "generic", apps: [] } });
    try {
      const loaded = loadAppsConfig(cfg);
      expect(loaded.apps).toEqual([]);
      expect(isSingleAppMode(loaded)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses the documented target.apps[] schema with per-env URL map", () => {
    const { dir, cfg } = makeFixture({
      targetProjectRoot: "..",
      target: {
        platform: "generic",
        apps: [
          {
            name: "web",
            rootDir: "../apps/web",
            url: {
              development: "http://localhost:3000",
              testing: "https://web-pr-123.preview.example.com",
              staging: "https://stg.example.com",
              production: "https://example.com",
            },
          },
          {
            name: "api",
            rootDir: "../apps/api",
            url: { staging: "https://api.stg.example.com" },
          },
        ],
      },
    });
    try {
      const loaded = loadAppsConfig(cfg);
      expect(loaded.apps).toHaveLength(2);
      expect(loaded.apps[0]?.name).toBe("web");
      expect(loaded.apps[0]?.rootDir).toBe("../apps/web");
      expect(loaded.apps[0]?.url.development).toBe("http://localhost:3000");
      expect(loaded.apps[1]?.name).toBe("api");
      expect(isSingleAppMode(loaded)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves optional framework / language / roles when present", () => {
    const { dir, cfg } = makeFixture({
      target: {
        apps: [
          {
            name: "web",
            rootDir: "../apps/web",
            url: { development: "http://localhost:3000" },
            framework: "vite-react-ts",
            language: "ts",
            roles: ["admin", "user"],
          },
        ],
      },
    });
    try {
      const loaded = loadAppsConfig(cfg);
      expect(loaded.apps[0]?.framework).toBe("vite-react-ts");
      expect(loaded.apps[0]?.language).toBe("ts");
      expect(loaded.apps[0]?.roles).toEqual(["admin", "user"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when an app entry is missing required fields", () => {
    const { dir, cfg } = makeFixture({
      target: { apps: [{ name: "web" }] }, // missing rootDir + url
    });
    try {
      expect(() => loadAppsConfig(cfg)).toThrow(/rootDir/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("multi-app — resolveApp / resolveAppUrl", () => {
  const cfg = {
    apps: [
      { name: "web", rootDir: "../apps/web", url: { staging: "https://stg.example.com" } },
      { name: "api", rootDir: "../apps/api", url: { staging: "https://api.stg.example.com" } },
    ],
    configDir: "/tmp",
    targetProjectRoot: "..",
  };

  it("resolves a single app by name", () => {
    expect(resolveApp(cfg, "web").rootDir).toBe("../apps/web");
  });

  it("throws with the available list when an app is missing", () => {
    expect(() => resolveApp(cfg, "admin")).toThrow(/Available: web, api/);
  });

  it("resolves multiple apps preserving order", () => {
    const result = resolveApps(cfg, ["api", "web"]);
    expect(result.map((a) => a.name)).toEqual(["api", "web"]);
  });

  it("returns the per-env URL", () => {
    expect(resolveAppUrl(cfg.apps[0]!, "staging")).toBe("https://stg.example.com");
  });

  it("throws when the requested env has no URL configured for that app", () => {
    expect(() => resolveAppUrl(cfg.apps[0]!, "production")).toThrow(/no URL configured.*production/);
  });
});

describe("multi-app — validateAppsExist", () => {
  it("flags apps whose rootDir does not exist on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "aegis-multiapp-validate-"));
    try {
      mkdirSync(join(dir, "apps", "web"), { recursive: true });
      const result = validateAppsExist({
        apps: [
          { name: "web", rootDir: "apps/web", url: {} },
          { name: "missing", rootDir: "apps/missing", url: {} },
        ],
        configDir: dir,
        targetProjectRoot: "..",
      });
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(["missing"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("multi-app — helpers", () => {
  it("buildSsoUrl encodes the token", () => {
    const url = buildSsoUrl("https://app.example.com", "abc/def+ghi");
    expect(url).toBe("https://app.example.com?sso_token=abc%2Fdef%2Bghi");
  });

  it("multiAppCycleLabel formats names", () => {
    expect(multiAppCycleLabel(["web", "api"])).toBe("web + api cross-app cycle");
  });
});
