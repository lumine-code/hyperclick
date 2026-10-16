describe("Hyperclick command availability", () => {
  let main, editor, lease;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("hyperclick")).mainModule;
    editor = await lumine.workspace.open();
  });
  afterEach(async () => {
    lease?.dispose();
    editor.destroy();
    await lumine.packages.deactivatePackage("hyperclick");
    lease = null;
  });
  it("requires a registered provider without running a provider lookup", () => {
    const getSuggestionForWord = jasmine.createSpy("lookup");
    expect(lumine.commands.canDispatch(editor.element, "hyperclick:confirm-cursor")).toBe(false);
    lease = main.consumeHyperclick({ getSuggestionForWord });
    expect(lumine.commands.canDispatch(editor.element, "hyperclick:confirm-cursor")).toBe(true);
    lease.dispose();
    expect(lumine.commands.canDispatch(editor.element, "hyperclick:confirm-cursor")).toBe(false);
    expect(getSuggestionForWord).not.toHaveBeenCalled();
  });
});
