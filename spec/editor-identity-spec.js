const path = require("node:path");
const os = require("node:os");

describe("Hyperclick pending editor identity", () => {
  // Analysis fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let editor, element, lease, resolve, callback, asked;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    await lumine.packages.activatePackage("hyperclick");
    editor = await lumine.workspace.open();
    editor.setText("alpha");
    editor.setCursorBufferPosition([0, 1]);
    element = lumine.views.getView(editor);
    jasmine.attachToDOM(element);
    callback = jasmine.createSpy("owned follow");
    asked = 0;
    lease = lumine.packages.serviceHub.provide("hyperclick.provider", "1.0.0", {
      providerName: "owned identity",
      getSuggestionForWord(_editor, _word, range) {
        asked++;
        return new Promise((finish) => {
          resolve = () => finish({ range, callback });
        });
      },
    });
  });
  afterEach(async () => {
    resolve?.();
    resolve = null;
    lease.dispose();
    editor.destroy();
    await lumine.packages.deactivatePackage("hyperclick");
  });
  for (const change of ["path", "grammar", "none"]) {
    it(`accepts the pending callback only while ${change} leaves its identity current`, async () => {
      if (change === "grammar") {
        await lumine.packages.activatePackage("language-javascript");
        const grammar = lumine.grammars.grammarForScopeName("source.js");
        expect(grammar).toBeTruthy();
        editor.setGrammar(grammar);
      }
      lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
      await conditionPromise(() => asked === 1);
      if (change === "path")
        editor.getBuffer().setPath(path.join(os.tmpdir(), "owned-hyperclick-new.txt"));
      if (change === "grammar") editor.setGrammar(lumine.grammars.nullGrammar);
      resolve();
      // Let the registry, lookup and public command completion settle.
      await new Promise((finish) => setTimeout(finish, 0));
      expect(callback.calls.count()).toBe(change === "none" ? 1 : 0);
      if (change !== "none") {
        if (change === "grammar") {
          expect(lumine.commands.canDispatch(element, "hyperclick:confirm-cursor")).toBeFalse();
          editor.setGrammar(lumine.grammars.grammarForScopeName("text.plain"));
        }
        lumine.commands.dispatch(element, "hyperclick:confirm-cursor");
        await conditionPromise(() => asked === 2);
        resolve();
        await new Promise((finish) => setTimeout(finish, 0));
        expect(callback).toHaveBeenCalledTimes(1);
      }
    });
  }
});
