describe("hyperclick in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("hyperclick");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("hyperclick");
    await lumine.workspace.discardEditorWindows();
  });
  it("routes modifier gestures and DOM links through the auxiliary document", async () => {
    const editor = await lumine.workspace.open();
    const extra = await lumine.workspace.detachItem(editor, { show: false });
    const main = lumine.packages.getActivePackage("hyperclick").mainModule;
    const control = main.editors.get(editor);
    const modifier = spyOn(control, "didChangeModifier");
    const nativeWindow = extra.getDocument().defaultView;
    nativeWindow.dispatchEvent(new nativeWindow.KeyboardEvent("keyup", { key: "Alt" }));
    expect(modifier).toHaveBeenCalled();
    const link = extra.getDocument().createElement("span");
    link.className = "native-dom-link";
    extra.getElement().appendChild(link);
    const callback = jasmine.createSpy("follow");
    const provider = main.consumeHyperclick({
      elementSelector: ".native-dom-link",
      getSuggestionForElement: (element) => ({ element, callback }),
    });
    await Promise.resolve();
    link.dispatchEvent(
      new nativeWindow.MouseEvent("mousedown", { bubbles: true, altKey: true, button: 0 }),
    );
    await conditionPromise(() => callback.calls.count() === 1);
    provider.dispose();
    link.remove();
    await lumine.workspace.attachWindow(extra);
    expect(main.elementControllers.has(extra)).toBe(false);
  });
});
