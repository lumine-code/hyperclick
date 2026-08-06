const { CompositeDisposable, Disposable } = require("atom");

const Config = require("./config");
const { wordRangeAt } = require("./word-range");

// Whether the modifier the user chose is held down for this event. `ctrl` means
// the platform's usual accelerator, which is Cmd on macOS.
function hasModifier(event) {
  if (Config.get("modifier") === "ctrl") {
    return process.platform === "darwin" ? event.metaKey : event.ctrlKey;
  }
  return event.altKey;
}

// Tracks one editor: watches the pointer while the modifier is held, asks the
// registry what the word under it means, underlines the answer, and runs it
// when clicked.
class HyperclickEditor {
  constructor(editor, registry) {
    this.editor = editor;
    this.registry = registry;
    this.element = atom.views.getView(editor);
    this.suggestion = null;
    this.markers = [];
    this.pendingRange = null;
    this.controller = null;
    this.hoverTimer = null;

    this.disposables = new CompositeDisposable();
    this.listen(this.element, "mousemove", (event) => this.didMouseMove(event));
    this.listen(this.element, "mouseout", () => this.clear());
    // Capture: the editor component's own mousedown moves the cursor, and a
    // followed link must not also reposition it.
    this.listen(this.element, "mousedown", (event) => this.didMouseDown(event), true);
    this.listen(window, "keydown", (event) => this.didChangeModifier(event));
    this.listen(window, "keyup", (event) => this.didChangeModifier(event));
    this.listen(window, "blur", () => this.clear());

    this.disposables.add(
      editor.onDidChangeCursorPosition(() => this.clear()),
      editor.getBuffer().onDidChange(() => this.clear()),
      editor.onDidChangeScrollTop?.(() => this.clear()) ?? new Disposable(() => {}),
    );
  }

  listen(target, name, handler, capture = false) {
    target.addEventListener(name, handler, capture);
    this.disposables.add(new Disposable(() => target.removeEventListener(name, handler, capture)));
  }

  destroy() {
    this.cancelPending();
    this.clear();
    this.disposables.dispose();
  }

  didChangeModifier(event) {
    // Releasing the modifier drops the affordance; pressing it mid-hover does
    // not resurrect one, because there is no pointer position to work from
    // until the next move.
    if (!hasModifier(event)) this.clear();
  }

  didMouseMove(event) {
    if (!hasModifier(event)) {
      this.clear();
      return;
    }

    const range = this.wordRangeForEvent(event);
    if (!range) {
      this.clear();
      return;
    }

    // Still inside the word we already answered for, or already asking about.
    if (this.suggestion?.wordRange.isEqual(range)) return;
    if (this.pendingRange?.isEqual(range)) return;

    this.clearSuggestion();
    this.scheduleLookup(range);
  }

  async didMouseDown(event) {
    if (event.button !== 0 || !hasModifier(event)) return;

    // A click can land before the hover lookup has answered — the pointer has
    // to arrive before it can be clicked. Resolve it now rather than making
    // the user wait and click again.
    let suggestion = this.suggestion;
    if (!suggestion) {
      const range = this.wordRangeForEvent(event);
      if (!range) return;
      // Suppress the cursor move now: awaiting first would let the editor's
      // own handler run, and by then preventing it is too late.
      event.preventDefault();
      event.stopPropagation();
      suggestion = await this.lookup(range, { decorate: false });
      if (!suggestion) return;
    } else {
      const position = this.bufferPositionForEvent(event);
      if (!position || !this.containsPosition(suggestion, position)) return;
      event.preventDefault();
      event.stopPropagation();
    }

    this.clear();
    this.confirm(suggestion);
  }

  confirm(suggestion) {
    try {
      suggestion.callback();
    } catch (error) {
      const name = suggestion.provider?.providerName ?? "(unnamed)";
      console.error(`hyperclick provider ${name} failed to follow its suggestion:`, error);
    }
  }

  // The keyboard path: follow whatever the cursor is sitting on.
  async confirmCursor() {
    const position = this.editor.getCursorBufferPosition();
    const range = wordRangeAt(this.editor, position);
    if (!range) return false;
    const suggestion = await this.lookup(range, { decorate: false });
    if (!suggestion) return false;
    this.clear();
    this.confirm(suggestion);
    return true;
  }

  scheduleLookup(range) {
    this.cancelPending();
    this.pendingRange = range;
    const delay = Config.get("hoverDelay") ?? 0;
    if (delay <= 0) {
      this.lookup(range);
      return;
    }
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      this.lookup(range);
    }, delay);
  }

  async lookup(range, { decorate = true } = {}) {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.pendingRange = range;

    const text = this.editor.getTextInBufferRange(range);
    const suggestion = await this.registry.getSuggestion(
      this.editor,
      text,
      range,
      controller.signal,
    );

    if (controller.signal.aborted) return null;
    if (this.controller === controller) {
      this.controller = null;
      this.pendingRange = null;
    }
    if (!suggestion) return null;

    const resolved = { ...suggestion, wordRange: range };
    if (decorate) this.show(resolved);
    return resolved;
  }

  cancelPending() {
    if (this.hoverTimer) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.controller?.abort();
    this.controller = null;
    this.pendingRange = null;
  }

  show(suggestion) {
    this.clearSuggestion();
    this.suggestion = suggestion;
    for (const range of this.rangesFor(suggestion)) {
      const marker = this.editor.markBufferRange(range, { invalidate: "touch" });
      this.editor.decorateMarker(marker, { type: "highlight", class: "hyperclick" });
      this.markers.push(marker);
    }
    this.element.classList.add("hyperclick");
  }

  rangesFor(suggestion) {
    return Array.isArray(suggestion.range) ? suggestion.range : [suggestion.range];
  }

  containsPosition(suggestion, position) {
    return this.rangesFor(suggestion).some((range) => range.containsPoint(position));
  }

  clear() {
    this.cancelPending();
    this.clearSuggestion();
  }

  clearSuggestion() {
    if (this.markers.length > 0) {
      for (const marker of this.markers) marker.destroy();
      this.markers = [];
    }
    if (this.suggestion) this.suggestion = null;
    this.element.classList.remove("hyperclick");
  }

  bufferPositionForEvent(event) {
    const component = this.element.getComponent?.() ?? this.element.component;
    if (!component) return null;
    let screenPosition;
    try {
      screenPosition = component.screenPositionForMouseEvent(event);
    } catch {
      return null;
    }
    if (!screenPosition) return null;
    return this.editor.bufferPositionForScreenPosition(screenPosition);
  }

  wordRangeForEvent(event) {
    const position = this.bufferPositionForEvent(event);
    if (!position) return null;
    return wordRangeAt(this.editor, position);
  }
}

module.exports = HyperclickEditor;
