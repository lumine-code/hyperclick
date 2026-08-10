const { Point, Range } = require("lumine");

const { conditionPromise } = require("./async-spec-helpers");

// A workspace-hosted editor in a headless spec believes it is invisible, so the
// component bails out of updating and nothing ever renders. Build the editor
// standalone, give its element a size, and attach it.
function attachEditor(editor) {
  const element = lumine.views.getView(editor);
  element.style.height = "300px";
  element.style.width = "600px";
  jasmine.attachToDOM(element);
  element.getComponent().updateSync();
  return element;
}

// The pixel coordinates of a buffer position, so a synthesized mouse event
// lands where the test means it to.
function clientPositionFor(editor, position) {
  const component = lumine.views.getView(editor).getComponent();
  const screenPosition = editor.screenPositionForBufferPosition(position);
  const { left, top } = component.pixelPositionForScreenPosition(screenPosition);
  const linesRect = component.refs.lineTiles.getBoundingClientRect();
  const clientPosition = {
    clientX: linesRect.left + left + 1,
    clientY: linesRect.top + top + component.getLineHeight() / 2,
  };

  // The point is only meaningful if the editor maps it back to the position it
  // was built from. When measurement is off -- an unrendered line, a font that
  // resolved late -- it does not, and every expectation downstream fails as a
  // timeout that never mentions the pointer. Say so here instead.
  const landed = component.screenPositionForMouseEvent(clientPosition);
  expect(`${landed.row},${landed.column}`).toBe(
    `${screenPosition.row},${screenPosition.column}`,
    `synthesized pointer for ${position} landed elsewhere`,
  );

  return clientPosition;
}

function mouseEvent(name, editor, position, options = {}) {
  return new MouseEvent(name, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...clientPositionFor(editor, position),
    ...options,
  });
}

function regionCount(element) {
  return element.querySelectorAll(".highlights .hyperclick .region").length;
}

describe("hyperclick", () => {
  let editor, element, mainModule, provider, calls;

  beforeEach(async () => {
    jasmine.unspy(Date, "now");
    jasmine.unspy(global, "setTimeout");

    lumine.config.set("hyperclick.hoverDelay", 0);
    lumine.config.set("hyperclick.modifier", "alt");

    const pack = await lumine.packages.activatePackage("hyperclick");
    mainModule = pack.mainModule;

    editor = await lumine.workspace.open();
    editor.setText("alpha beta\ngamma delta\n");
    element = attachEditor(editor);

    calls = [];
    provider = {
      priority: 1,
      providerName: "stub",
      getSuggestionForWord(anEditor, text, range) {
        if (text !== "alpha") return;
        return { range, callback: () => calls.push(text) };
      },
    };
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("hyperclick");
  });

  function register(aProvider = provider) {
    return mainModule.consumeHyperclick(aProvider);
  }

  describe("activation", () => {
    it("watches editors that were already open", async () => {
      // `observeTextEditors` calls back synchronously for every open editor,
      // so activating with one on screen exercises the ordering inside
      // `activate` that a fresh-workspace activation never reaches.
      await lumine.packages.deactivatePackage("hyperclick");
      const pack = await lumine.packages.activatePackage("hyperclick");

      expect(pack.mainActivated).toBe(true);
      expect(pack.mainModule.editors.has(editor)).toBe(true);
      // Service consumption is wired only once activation completes without
      // throwing, so a broken `activate` leaves every provider unregistered.
      expect(typeof pack.mainModule.consumeHyperclick).toBe("function");
      expect(pack.mainModule.registry).not.toBeUndefined();
    });

    it("stops watching an editor once it is destroyed", async () => {
      expect(mainModule.editors.has(editor)).toBe(true);
      editor.destroy();
      expect(mainModule.editors.has(editor)).toBe(false);
    });
  });

  describe("when the pointer moves with the modifier held", () => {
    it("underlines a word a provider claims", async () => {
      register();
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 2], { altKey: true }));
      await conditionPromise(() => {
        element.getComponent().updateSync();
        return regionCount(element) > 0;
      });
      expect(element.classList.contains("hyperclick")).toBe(true);
    });

    it("leaves a word no provider claims alone", async () => {
      register();
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 7], { altKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      element.getComponent().updateSync();
      expect(regionCount(element)).toBe(0);
      expect(element.classList.contains("hyperclick")).toBe(false);
    });

    it("does nothing without the modifier", async () => {
      register();
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 2]));
      await new Promise((resolve) => setTimeout(resolve, 50));
      element.getComponent().updateSync();
      expect(regionCount(element)).toBe(0);
    });

    it("clears the affordance when the modifier is released", async () => {
      register();
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 2], { altKey: true }));
      await conditionPromise(() => {
        element.getComponent().updateSync();
        return regionCount(element) > 0;
      });

      window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, altKey: false }));
      element.getComponent().updateSync();
      expect(regionCount(element)).toBe(0);
      expect(element.classList.contains("hyperclick")).toBe(false);
    });

    it("asks a provider once while the pointer stays inside one word", async () => {
      spyOn(provider, "getSuggestionForWord").andCallThrough();
      register();
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 1], { altKey: true }));
      await conditionPromise(() => provider.getSuggestionForWord.callCount === 1);
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 3], { altKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(provider.getSuggestionForWord.callCount).toBe(1);
    });
  });

  describe("when a claimed word is clicked with the modifier held", () => {
    it("runs the callback and does not move the cursor", async () => {
      register();
      editor.setCursorBufferPosition([1, 0]);
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 2], { altKey: true }));
      await conditionPromise(() => {
        element.getComponent().updateSync();
        return regionCount(element) > 0;
      });

      const event = mouseEvent("mousedown", editor, [0, 2], { altKey: true });
      element.dispatchEvent(event);
      await conditionPromise(() => calls.length === 1);

      expect(calls).toEqual(["alpha"]);
      expect(event.defaultPrevented).toBe(true);
      expect(editor.getCursorBufferPosition().isEqual([1, 0])).toBe(true);
    });

    it("resolves a click that arrives before the hover lookup has answered", async () => {
      let release;
      provider.getSuggestionForWord = (anEditor, text, range) =>
        new Promise((resolve) => {
          release = () => resolve({ range, callback: () => calls.push(text) });
        });
      register();

      const event = mouseEvent("mousedown", editor, [0, 2], { altKey: true });
      element.dispatchEvent(event);
      await conditionPromise(() => !!release);
      release();
      await conditionPromise(() => calls.length === 1);
      expect(event.defaultPrevented).toBe(true);
    });

    it("ignores a click without the modifier", async () => {
      register();
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 2], { altKey: true }));
      await conditionPromise(() => {
        element.getComponent().updateSync();
        return regionCount(element) > 0;
      });

      const event = mouseEvent("mousedown", editor, [0, 2]);
      element.dispatchEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toEqual([]);
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("hyperclick:confirm-cursor", () => {
    it("follows the symbol under the cursor", async () => {
      register();
      editor.setCursorBufferPosition([0, 2]);
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await conditionPromise(() => calls.length === 1);
      expect(calls).toEqual(["alpha"]);
    });

    it("does nothing when no provider claims the word", async () => {
      register();
      editor.setCursorBufferPosition([1, 2]);
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toEqual([]);
    });
  });

  describe("provider selection", () => {
    it("prefers the highest priority provider", async () => {
      const low = {
        priority: 1,
        providerName: "low",
        getSuggestionForWord: (anEditor, text, range) => ({
          range,
          callback: () => calls.push("low"),
        }),
      };
      const high = {
        priority: 5,
        providerName: "high",
        getSuggestionForWord: (anEditor, text, range) => ({
          range,
          callback: () => calls.push("high"),
        }),
      };
      register(low);
      register(high);

      editor.setCursorBufferPosition([1, 2]);
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await conditionPromise(() => calls.length === 1);
      expect(calls).toEqual(["high"]);
    });

    it("falls through to the next provider when one declines", async () => {
      const declining = {
        priority: 5,
        providerName: "declining",
        getSuggestionForWord: () => undefined,
      };
      register(declining);
      register();

      editor.setCursorBufferPosition([0, 2]);
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await conditionPromise(() => calls.length === 1);
      expect(calls).toEqual(["alpha"]);
    });

    it("keeps asking after a provider throws", async () => {
      const throwing = {
        priority: 5,
        providerName: "throwing",
        getSuggestionForWord() {
          throw new Error("boom");
        },
      };
      spyOn(console, "error");
      register(throwing);
      register();

      editor.setCursorBufferPosition([0, 2]);
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await conditionPromise(() => calls.length === 1);
      expect(console.error).toHaveBeenCalled();
    });

    it("stops asking a provider once its subscription is disposed", async () => {
      const disposable = register();
      disposable.dispose();

      editor.setCursorBufferPosition([0, 2]);
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toEqual([]);
    });

    it("accepts an array of providers from one package", async () => {
      mainModule.consumeHyperclick([
        { priority: 1, getSuggestionForWord: () => undefined },
        provider,
      ]);
      editor.setCursorBufferPosition([0, 2]);
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await conditionPromise(() => calls.length === 1);
    });

    it("skips a provider whose disableForSelector matches the scope", async () => {
      await lumine.packages.activatePackage("language-javascript");
      const jsEditor = await lumine.workspace.open("sample.js");
      jsEditor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
      jsEditor.setText("// alpha beta\n");
      const languageMode = jsEditor.getBuffer().getLanguageMode();
      if (languageMode.ready) await languageMode.ready;
      attachEditor(jsEditor);

      const commentProvider = {
        priority: 1,
        providerName: "comment-shy",
        disableForSelector: ".comment",
        getSuggestionForWord: (anEditor, text, range) => ({
          range,
          callback: () => calls.push(text),
        }),
      };
      register(commentProvider);

      jsEditor.setCursorBufferPosition([0, 4]);
      lumine.commands.dispatch(lumine.views.getView(jsEditor), "hyperclick:confirm-cursor");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(calls).toEqual([]);
    });
  });

  describe("suggestion ranges", () => {
    it("underlines every range of a multi-range suggestion", async () => {
      register({
        priority: 1,
        providerName: "multi",
        getSuggestionForWord: () => ({
          range: [
            new Range(new Point(0, 0), new Point(0, 5)),
            new Range(new Point(1, 0), new Point(1, 5)),
          ],
          callback: () => calls.push("multi"),
        }),
      });

      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 2], { altKey: true }));
      await conditionPromise(() => {
        element.getComponent().updateSync();
        return regionCount(element) >= 2;
      });
      expect(regionCount(element)).toBe(2);
    });
  });
});
