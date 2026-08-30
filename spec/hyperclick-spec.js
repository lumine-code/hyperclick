const { Point, Range } = require("lumine");

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

// What the editor and the controller believed at the moment a wait gave up.
//
// The affordance needs four things to line up: a controller watching this
// editor, a lookup that produced a suggestion, a marker for it, and a component
// that renders the marker. A bare "timed out" is consistent with all four
// failing and they want different fixes, so name which one did.
//
// The runner has already reported `watched true` with `suggestion false` on a
// loaded Linux and Windows runner, which narrows it to the lookup. The three
// remaining shapes are told apart here: `registry 0` means the provider was
// registered on a module the live controller is not using, `pending` non-null
// means a lookup started and never came back, and both empty means the pointer
// never reached one.
function renderState(element, mainModule, editor, asked) {
  const component = element.getComponent();
  const controller = mainModule.editors.get(editor);
  return (
    `asked ${JSON.stringify(asked)}, ` +
    `line ${JSON.stringify(editor.lineTextForBufferRow(0))}, ` +
    `watched ${mainModule.editors.has(editor)}, ` +
    `suggestion ${Boolean(controller?.suggestion)}, ` +
    `registry ${controller?.registry?.size}, ` +
    `sameRegistry ${controller?.registry === mainModule.registry}, ` +
    `pending ${controller?.pendingRange?.toString() ?? "null"}, ` +
    `inFlight ${Boolean(controller?.controller)}, ` +
    `timer ${Boolean(controller?.hoverTimer)}, ` +
    `hoverDelay ${lumine.config.get("hyperclick.hoverDelay")}, ` +
    `modifier ${lumine.config.get("hyperclick.modifier")}, ` +
    `visible ${component.visible}, measured ${component.hasInitialMeasurements}, ` +
    `rows ${component.getRenderedStartRow()}-${component.getRenderedEndRow()}, ` +
    `regions ${regionCount(element)}, class ${element.classList.contains("hyperclick")}`
  );
}

// The pixel coordinates of a buffer position, so a synthesized mouse event
// lands where the test means it to. Computed fresh on every call: the editor
// may still be settling its measurements, and a point cached from before a
// settle aims at a different word afterwards.
function rawClientPositionFor(editor, position) {
  const component = lumine.views.getView(editor).getComponent();
  const screenPosition = editor.screenPositionForBufferPosition(position);
  const { left, top } = component.pixelPositionForScreenPosition(screenPosition);
  const linesRect = component.refs.lineTiles.getBoundingClientRect();
  return {
    clientX: linesRect.left + left + 1,
    clientY: linesRect.top + top + component.getLineHeight() / 2,
  };
}

function clientPositionFor(editor, position) {
  const clientPosition = rawClientPositionFor(editor, position);

  // The point is only meaningful if the editor maps it back to the position it
  // was built from. When measurement is off -- an unrendered line, a font that
  // resolved late -- it does not, and every expectation downstream fails as a
  // timeout that never mentions the pointer. Say so here instead.
  const component = lumine.views.getView(editor).getComponent();
  const screenPosition = editor.screenPositionForBufferPosition(position);
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

// A pointer resting on a word, rather than one mousemove and then nothing.
//
// The affordance is torn down by `clear()`, which is wired to a good half dozen
// signals that have nothing to do with the pointer -- the window losing focus,
// a stray key event without the modifier, a cursor move, the editor settling
// its scroll position. A single synthesized move has to survive all of them for
// the whole wait, and on a loaded runner one of them reliably lands: the run
// that pinned this down reported the provider asked exactly once, with exactly
// the right word, and every trace of the answer then scrubbed -- the shape only
// a clear() can leave. A real hover re-establishes the affordance on the next
// pointer move, hundreds of times a second, so send the move on every poll and
// the spec depends on hyperclick answering a hover rather than on the runner
// staying quiet. A genuine regression still fails: when no provider claims the
// word, no number of moves paints a region.
//
// The round trip is asserted once up front; re-asserting on every poll would
// bury a real failure under three hundred passing expectations.
function hoverAt(element, editor, position, options = { altKey: true }) {
  clientPositionFor(editor, position);
  return () =>
    element.dispatchEvent(
      new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...rawClientPositionFor(editor, position),
        ...options,
      }),
    );
}

function regionCount(element) {
  return element.querySelectorAll(".highlights .hyperclick .region").length;
}

describe("hyperclick", () => {
  let editor, element, mainModule, provider, calls, asked;

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
    // Every word the provider was asked about. The stub declines anything but
    // `alpha`, so when an affordance never appears this says whether the
    // pointer resolved to the wrong word or never produced a lookup at all.
    asked = [];
    provider = {
      priority: 1,
      providerName: "stub",
      getSuggestionForWord(anEditor, text, range) {
        asked.push(text);
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

    it("watches registered embedded editors, but not background or mini ones", () => {
      // A notebook cell is a registered fragment, not a pane item — hyperclick
      // works there. The hidden JSON projection is a background editor and
      // never takes the pointer; minis were always excluded.
      const fragment = lumine.workspace.buildTextEditor();
      const fragmentRegistration = lumine.textEditors.add(fragment, { role: "fragment" });
      const background = lumine.workspace.buildTextEditor();
      const backgroundRegistration = lumine.textEditors.add(background, { role: "background" });
      const mini = lumine.workspace.buildTextEditor({ mini: true });
      const miniRegistration = lumine.textEditors.add(mini);

      expect(mainModule.editors.has(fragment)).toBe(true);
      expect(mainModule.editors.has(background)).toBe(false);
      expect(mainModule.editors.has(mini)).toBe(false);

      fragmentRegistration.dispose();
      backgroundRegistration.dispose();
      miniRegistration.dispose();
      fragment.destroy();
      background.destroy();
      mini.destroy();
    });
  });

  describe("window surfaces", () => {
    it("moves modifier and blur listeners with a detached editor", async () => {
      const controller = mainModule.editors.get(editor);
      spyOn(controller, "clear").and.callThrough();
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);

      const surfaceFor = (document_, id, kind) => ({
        id,
        kind,
        window: document_.defaultView,
        document: document_,
        element: document_.body,
      });
      const moveTo = async (targetDocument, reason) => {
        const sourceDocument = element.ownerDocument;
        const transition = await lumine.workspace.windowSurfaceTransitions.begin({
          item: editor,
          from: surfaceFor(
            sourceDocument,
            sourceDocument === document ? "primary" : "detached",
            sourceDocument === document ? "primary" : "detached-pane",
          ),
          to: surfaceFor(
            targetDocument,
            targetDocument === document ? "primary" : "detached",
            targetDocument === document ? "primary" : "detached-pane",
          ),
          reason,
        });
        targetDocument.adoptNode(element);
        targetDocument.body.appendChild(element);
        await transition.commit();
        transition.complete();
      };

      await moveTo(frame.contentDocument, "detach");

      try {
        controller.clear.calls.reset();
        frame.contentWindow.dispatchEvent(
          new frame.contentWindow.KeyboardEvent("keyup", { bubbles: true, altKey: false }),
        );
        expect(controller.clear.calls.count()).toBe(1);

        controller.clear.calls.reset();
        frame.contentWindow.dispatchEvent(new frame.contentWindow.FocusEvent("blur"));
        expect(controller.clear.calls.count()).toBe(1);

        controller.clear.calls.reset();
        window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, altKey: false }));
        expect(controller.clear).not.toHaveBeenCalled();

        await moveTo(document, "attach");
        controller.clear.calls.reset();
        window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, altKey: false }));
        expect(controller.clear.calls.count()).toBe(1);
      } finally {
        if (element.ownerDocument !== document) await moveTo(document, "attach");
        jasmine.attachToDOM(element);
        frame.remove();
      }
    });
  });

  describe("when the pointer moves with the modifier held", () => {
    it("underlines a word a provider claims", async () => {
      register();
      const hover = hoverAt(element, editor, [0, 2]);
      await conditionPromise(
        () => {
          hover();
          element.getComponent().updateSync();
          return regionCount(element) > 0;
        },
        () => `an underlined region (${renderState(element, mainModule, editor, asked)})`,
      );
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
      const hover = hoverAt(element, editor, [0, 2]);
      await conditionPromise(
        () => {
          hover();
          element.getComponent().updateSync();
          return regionCount(element) > 0;
        },
        () => `an underlined region (${renderState(element, mainModule, editor, asked)})`,
      );

      window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, altKey: false }));
      element.getComponent().updateSync();
      expect(regionCount(element)).toBe(0);
      expect(element.classList.contains("hyperclick")).toBe(false);
    });

    it("asks a provider once while the pointer stays inside one word", async () => {
      spyOn(provider, "getSuggestionForWord").and.callThrough();
      register();
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 1], { altKey: true }));
      await conditionPromise(() => provider.getSuggestionForWord.calls.count() === 1);
      element.dispatchEvent(mouseEvent("mousemove", editor, [0, 3], { altKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(provider.getSuggestionForWord.calls.count()).toBe(1);
    });
  });

  describe("when a claimed word is clicked with the modifier held", () => {
    it("runs the callback and does not move the cursor", async () => {
      register();
      editor.setCursorBufferPosition([1, 0]);
      const hover = hoverAt(element, editor, [0, 2]);
      await conditionPromise(
        () => {
          hover();
          element.getComponent().updateSync();
          return regionCount(element) > 0;
        },
        () => `an underlined region (${renderState(element, mainModule, editor, asked)})`,
      );

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
      const hover = hoverAt(element, editor, [0, 2]);
      await conditionPromise(
        () => {
          hover();
          element.getComponent().updateSync();
          return regionCount(element) > 0;
        },
        () => `an underlined region (${renderState(element, mainModule, editor, asked)})`,
      );

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

      const hover = hoverAt(element, editor, [0, 2]);
      await conditionPromise(
        () => {
          hover();
          element.getComponent().updateSync();
          return regionCount(element) >= 2;
        },
        () => `two underlined regions (${renderState(element, mainModule, editor, asked)})`,
      );
      expect(regionCount(element)).toBe(2);
    });
  });
});
