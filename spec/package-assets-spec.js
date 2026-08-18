const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

describe("hyperclick package assets", () => {
  it("is named `hyperclick` and points its metadata at its repository", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.name).toBe("hyperclick");
    expect(pkg.author).toBe("lumine-code");
    expect(pkg.repository).toBe("https://github.com/lumine-code/hyperclick");
    expect(pkg.bugs.url).toBe("https://github.com/lumine-code/hyperclick/issues");
    expect(pkg.main).toBe("./lib/main");
  });

  it("consumes hyperclick.provider and provides nothing", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.consumedServices["hyperclick.provider"].versions["^1.0.0"]).toBe(
      "consumeHyperclick",
    );
    expect(pkg.providedServices).toBeUndefined();
  });

  it("owns the contract document for the service it consumes", () => {
    expect(exists("docs/hyperclick.provider.md")).toBe(true);
    const doc = read("docs/hyperclick.provider.md");
    expect(doc).toContain("consumeHyperclick");
    expect(doc.split(/\r?\n/)[0]).toBe("# hyperclick.provider");
  });

  it("defines the config schema under the hyperclick namespace without order keys", () => {
    const pkg = JSON.parse(read("package.json"));
    const schema = pkg.configSchema;
    expect(Object.keys(schema).sort()).toEqual(["hoverDelay", "modifier"]);
    for (const entry of Object.values(schema)) {
      expect(entry.order).toBeUndefined();
      expect(entry.title).toBeDefined();
      expect(entry.description).toBeDefined();
      expect(entry.type).toBeDefined();
      const keys = Object.keys(entry);
      expect(keys[keys.length - 1]).toBe("default");
    }
    // Ctrl is the editor's add-a-cursor modifier on every platform, so it must
    // not be what this package takes by default.
    expect(schema.modifier.default).toBe("alt");
  });

  it("ships background tips right after engines", () => {
    const pkg = JSON.parse(read("package.json"));
    const keys = Object.keys(pkg);
    expect(keys[keys.indexOf("engines") + 1]).toBe("backgroundTips");
    expect(pkg.backgroundTips.length).toBeGreaterThan(0);
    expect(pkg.backgroundTips.length).toBeLessThan(4);
  });

  it("scopes its stylesheet to a highlight decoration, not a text decoration", () => {
    const css = read("styles/main.css");
    expect(css).toContain(".highlights .hyperclick .region");
    expect(css).toContain("var(--");
  });

  it("keeps the README description in sync with package.json", () => {
    const pkg = JSON.parse(read("package.json"));
    const lines = read("README.md").split(/\r?\n/);
    expect(lines[0]).toBe("# hyperclick");
    const sentence = lines.find((line, index) => index > 0 && line.trim().length > 0);
    expect(sentence).toBe(pkg.description);
  });

  it("declares no runtime dependencies", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies).toBeUndefined();
  });
});
