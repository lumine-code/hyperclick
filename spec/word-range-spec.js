const { Point } = require("lumine");

const { wordRangeAt } = require("../lib/word-range");

describe("wordRangeAt", () => {
  // Analysis fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let editor;

  beforeEach(async () => {
    editor = await lumine.workspace.open();
  });

  function textAt(row, column) {
    const range = wordRangeAt(editor, new Point(row, column));
    return range ? editor.getTextInBufferRange(range) : null;
  }

  it("finds the word around a position", () => {
    editor.setText("alpha beta gamma\n");
    expect(textAt(0, 0)).toBe("alpha");
    expect(textAt(0, 3)).toBe("alpha");
    expect(textAt(0, 6)).toBe("beta");
    expect(textAt(0, 13)).toBe("gamma");
  });

  it("resolves a complete word far into a long row without reading the whole row", () => {
    editor.setText("x".repeat(100000) + " target tail");
    spyOn(editor, "lineTextForBufferRow").and.throwError("whole line read");
    const range = wordRangeAt(editor, new Point(0, 100003));
    expect(range.start.column).toBe(100001);
    expect(range.end.column).toBe(100007);
  });

  it("declines oversized words instead of supplying a truncated target", () => {
    editor.setText("a".repeat(4097));
    expect(wordRangeAt(editor, new Point(0, 2000))).toBeNull();
    editor.setText("a".repeat(4096));
    expect(wordRangeAt(editor, new Point(0, 2000)).end.column).toBe(4096);
  });

  it("guards direct provider lookups before reading a large selected range", async () => {
    const read = jasmine.createSpy("source text");
    const resolve = jasmine.createSpy("provider");
    const context = {
      editor: {
        getGrammar: () => ({}),
        getBuffer: () => ({ characterIndexForPosition: (point) => point.column }),
        getTextInBufferRange: read,
      },
      registry: { getSuggestion: resolve },
      cancelPending: jasmine.createSpy("cancel"),
    };
    const { Range } = require("lumine");
    expect(
      await require("../lib/hyperclick-editor").prototype.lookup.call(
        context,
        new Range([0, 0], [0, 600000000]),
      ),
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(context.cancelPending).toHaveBeenCalled();
  });

  it("returns null on whitespace", () => {
    editor.setText("alpha beta\n");
    expect(textAt(0, 5)).toBeNull();
  });

  it("returns null past the end of a line", () => {
    // The editor clamps a mouse position into the text area, so the empty
    // space right of a short line reports its last column. Answering there
    // would underline the final word of every line the pointer crossed.
    editor.setText("alpha\n");
    expect(textAt(0, 5)).toBeNull();
    expect(textAt(0, 40)).toBeNull();
  });

  it("returns null on an empty line", () => {
    editor.setText("\nalpha\n");
    expect(textAt(0, 0)).toBeNull();
  });

  it("splits on the editor's non-word characters", () => {
    editor.setText("foo.bar(baz)\n");
    expect(textAt(0, 1)).toBe("foo");
    expect(textAt(0, 5)).toBe("bar");
    expect(textAt(0, 9)).toBe("baz");
    // The punctuation itself is not a target.
    expect(textAt(0, 3)).toBeNull();
    expect(textAt(0, 7)).toBeNull();
  });

  it("honors a nonWordCharacters override", () => {
    // `-` is a word boundary by default, so a hyphenated identifier is two
    // words until the setting says otherwise.
    editor.setText("foo-bar\n");
    expect(textAt(0, 1)).toBe("foo");
    expect(textAt(0, 5)).toBe("bar");

    // Per-grammar word boundaries live under `language.*`, not `editor.*`.
    lumine.config.set("editor.nonWordCharacters", "()[]{}");
    expect(textAt(0, 1)).toBe("foo-bar");
    expect(textAt(0, 5)).toBe("foo-bar");
  });

  it("returns null for a row that does not exist", () => {
    editor.setText("alpha\n");
    expect(wordRangeAt(editor, new Point(9, 0))).toBeNull();
  });
});
