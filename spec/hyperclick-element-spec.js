const { Range } = require("lumine");

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("hyperclick rendered DOM locations", () => {
  let main;
  let root;
  let surface;
  let link;
  let child;
  let follow;
  let lookup;
  let registration;
  let previousDelay;
  let editor;

  beforeEach(async () => {
    jasmine.useRealClock();
    previousDelay = lumine.config.get("hyperclick.hoverDelay");
    lumine.config.set("hyperclick.hoverDelay", 0);
    const pack = await lumine.packages.activatePackage("hyperclick");
    main = pack.mainModule;
    root = lumine.views.getView(lumine.workspace);
    if (!root.isConnected) jasmine.attachToDOM(root);
    surface = document.createElement("div");
    surface.setAttribute("data-hyperclick-boundary", "");
    surface.className = "dom-contract-surface";
    link = document.createElement("span");
    link.className = "dom-contract-link";
    link.setAttribute("data-hyperclick-revision", "0");
    link.setAttribute("role", "link");
    link.tabIndex = 0;
    child = document.createElement("span");
    child.textContent = "File example.py, line 4";
    link.appendChild(child);
    surface.appendChild(link);
    root.appendChild(surface);
    follow = jasmine.createSpy("follow DOM source");
    lookup = jasmine.createSpy("getSuggestionForElement").and.callFake((element) => {
      const revision = element.getAttribute("data-hyperclick-revision");
      return {
        element,
        callback: follow,
        isCurrent: () => element.getAttribute("data-hyperclick-revision") === revision,
      };
    });
    registration = main.consumeHyperclick({
      providerName: "dom-contract",
      elementSelector: ".dom-contract-link",
      getSuggestionForElement: lookup,
    });
    await flush();
  });

  afterEach(async () => {
    registration?.dispose();
    await lumine.packages.deactivatePackage("hyperclick");
    surface.remove();
    editor?.destroy();
    editor = null;
    if (previousDelay === undefined) lumine.config.unset("hyperclick.hoverDelay");
    else lumine.config.set("hyperclick.hoverDelay", previousDelay);
  });

  function mouse(type, options = {}, target = child) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 25,
      clientY: 30,
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  }
  function key(type, options, target = window) {
    const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
  }
  async function hover() {
    mouse("mousemove", { altKey: true });
    await flush();
  }

  it("publishes one workspace DOM controller and accepts an element-only provider", () => {
    expect(main.elementController.element).toBe(root);
    expect(main.elementController.registry).toBe(main.registry);
    expect(main.registry.elementTarget(child)).toBe(link);
  });

  it("does no lookup, decoration or navigation for plain hover and plain click", async () => {
    mouse("mousemove");
    const down = mouse("mousedown");
    const click = mouse("click");
    await flush();
    expect(lookup).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(click.defaultPrevented).toBe(false);
  });

  it("waits for the configured Alt hover delay before offering a DOM affordance", async () => {
    lumine.config.set("hyperclick.hoverDelay", 30);
    mouse("mousemove", { altKey: true });
    expect(main.elementController.hoverTimer).not.toBe(null);
    expect(lookup).not.toHaveBeenCalled();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
    await delay(60);
    await flush();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(link.classList.contains("hyperclick-dom-link")).toBe(true);
    expect(follow).not.toHaveBeenCalled();
  });

  it("follows Alt left mousedown once and suppresses its trailing click and ancestor copy", async () => {
    const ancestor = jasmine.createSpy("ancestor output copy");
    surface.addEventListener("click", ancestor);
    await hover();
    const down = mouse("mousedown", { altKey: true });
    await flush();
    const click = mouse("click", { altKey: true });
    await flush();
    expect(down.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(ancestor).not.toHaveBeenCalled();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
  });

  it("consumes the trailing click even if Alt was released after following on mousedown", async () => {
    const ancestor = jasmine.createSpy("ancestor output copy");
    surface.addEventListener("click", ancestor);
    mouse("mousedown", { altKey: true });
    await flush();
    expect(follow).toHaveBeenCalledTimes(1);
    key("keyup", { key: "Alt", altKey: false });
    const click = mouse("click", { altKey: false });
    await flush();
    expect(click.defaultPrevented).toBe(true);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(ancestor).not.toHaveBeenCalled();
    mouse("mousedown", { altKey: false });
    const next = mouse("click", { altKey: false });
    expect(next.defaultPrevented).toBe(false);
    expect(ancestor).toHaveBeenCalledTimes(1);
  });

  it("does not follow right or middle Alt clicks", async () => {
    mouse("mousedown", { altKey: true, button: 1 });
    mouse("mousedown", { altKey: true, button: 2 });
    await flush();
    expect(lookup).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
  });

  it("checks a stationary pointer immediately when Alt is pressed", async () => {
    lumine.config.set("hyperclick.hoverDelay", 10000);
    spyOn(document, "elementFromPoint").and.returnValue(child);
    mouse("mousemove");
    expect(lookup).not.toHaveBeenCalled();
    key("keydown", { key: "Alt", altKey: true });
    await flush();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(link.classList.contains("hyperclick-dom-link")).toBe(true);
    expect(main.elementController.hoverTimer).toBe(null);
  });

  it("aborts a pending lookup and drops its answer when Alt is released", async () => {
    const answer = deferred();
    lookup.and.returnValue(answer.promise);
    mouse("mousemove", { altKey: true });
    const signal = lookup.calls.mostRecent().args[1].signal;
    key("keyup", { key: "Alt", altKey: false });
    expect(signal.aborted).toBe(true);
    answer.resolve({ element: link, callback: follow });
    await flush();
    expect(main.elementController.suggestion).toBe(null);
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
    expect(follow).not.toHaveBeenCalled();
  });

  it("drops pending navigation when the window loses focus", async () => {
    const answer = deferred();
    lookup.and.returnValue(answer.promise);
    mouse("mousedown", { altKey: true });
    const signal = lookup.calls.mostRecent().args[1].signal;
    window.dispatchEvent(new Event("blur"));
    expect(signal.aborted).toBe(true);
    answer.resolve({ element: link, callback: follow });
    await flush();
    expect(follow).not.toHaveBeenCalled();
    expect(main.elementController.suggestion).toBe(null);
  });

  it("removes displayed links and refuses late callbacks after provider withdrawal", async () => {
    await hover();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(true);
    registration.dispose();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
    mouse("mousedown", { altKey: true });
    await flush();
    expect(follow).not.toHaveBeenCalled();
  });

  it("drops an awaiting answer if its provider is withdrawn and registered again", async () => {
    registration.dispose();
    const answer = deferred();
    const provider = {
      elementSelector: ".dom-contract-link",
      getSuggestionForElement: () => answer.promise,
    };
    registration = main.consumeHyperclick(provider);
    mouse("mousedown", { altKey: true });
    registration.dispose();
    registration = main.consumeHyperclick(provider);
    answer.resolve({ element: link, callback: follow });
    await flush();
    expect(follow).not.toHaveBeenCalled();
    expect(main.elementController.suggestion).toBe(null);
  });

  it("clears temporary classes when the registered element is removed", async () => {
    await hover();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(true);
    link.remove();
    await flush();
    expect(main.elementController.suggestion).toBe(null);
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
    expect(follow).not.toHaveBeenCalled();
  });

  it("invalidates a pending click when a producer reuses the element with a new revision", async () => {
    const answer = deferred();
    lookup.and.returnValue(answer.promise);
    mouse("mousedown", { altKey: true });
    link.setAttribute("data-hyperclick-revision", "1");
    await flush();
    answer.resolve({ element: link, callback: follow });
    await flush();
    expect(follow).not.toHaveBeenCalled();
    expect(main.elementController.suggestion).toBe(null);
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
  });

  it("clears a displayed stale revision without reacting to unrelated workspace changes", async () => {
    await hover();
    const unrelated = document.createElement("div");
    surface.appendChild(unrelated);
    unrelated.textContent = "Another output changed";
    await flush();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(true);
    link.setAttribute("data-hyperclick-revision", "1");
    await flush();
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
    expect(main.elementController.suggestion).toBe(null);
  });

  it("follows a focused DOM link with Enter without requiring the pointer modifier", async () => {
    link.focus();
    expect(document.activeElement).toBe(link);
    const event = key("keydown", { key: "Enter", altKey: false }, link);
    await flush();
    expect(event.defaultPrevented).toBe(true);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(link.classList.contains("hyperclick-dom-link")).toBe(false);
  });

  it("does not run an editor word lookup beneath an unresolved output boundary", async () => {
    editor = await lumine.workspace.open();
    editor.setText("alpha\n");
    const editorElement = lumine.views.getView(editor);
    editorElement.style.height = "180px";
    editorElement.style.width = "400px";
    if (!editorElement.isConnected) root.appendChild(editorElement);
    const boundary = document.createElement("div");
    boundary.setAttribute("data-hyperclick-boundary", "");
    boundary.textContent = "Unresolved traceback text";
    editorElement.appendChild(boundary);
    const controller = main.editors.get(editor);
    const wordLookup = jasmine.createSpy("getSuggestionForWord");
    const words = main.consumeHyperclick({ getSuggestionForWord: wordLookup });
    try {
      const range = spyOn(controller, "wordRangeForEvent").and.returnValue(
        new Range([0, 0], [0, 5]),
      );
      mouse("mousemove", { altKey: true }, boundary);
      mouse("mousedown", { altKey: true }, boundary);
      key("keydown", { key: "Alt", altKey: true });
      await flush();
      expect(range).not.toHaveBeenCalled();
      expect(wordLookup).not.toHaveBeenCalled();
      expect(controller.pointerPosition).toBe(null);
    } finally {
      words.dispose();
      boundary.remove();
    }
  });
});
