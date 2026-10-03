const { CompositeDisposable, Disposable } = require("lumine");
const { modifierHeld, mouseActivation, hoverDelay } = require("./gesture");

// Rendered output has DOM locations rather than buffer ranges. The same
// consumer owns its gestures, so a producer never installs a second link policy.
class HyperclickElement {
  constructor(element, registry, { onClaimElement } = {}) {
    this.element = element;
    this.registry = registry;
    this.onClaimElement = onClaimElement;
    this.suggestion = null;
    this.pointerPosition = null;
    this.pendingElement = null;
    this.controller = null;
    this.hoverTimer = null;
    this.generation = 0;
    this.destroyed = false;
    this.mouseGesture = null;
    this.disposables = new CompositeDisposable();
    this.listen(element, "mousemove", (event) => this.didMouseMove(event));
    this.listen(element, "mouseleave", () => {
      this.pointerPosition = null;
      this.clear();
    });
    this.listen(element, "mousedown", (event) => this.didMouseDown(event), true);
    // Following on mousedown must not also activate a producer button or copy
    // the output via an ancestor's click handler.
    this.listen(
      element,
      "click",
      (event) => {
        const claimed = this.mouseGesture?.contains(event.target);
        this.mouseGesture = null;
        if (claimed || (mouseActivation(event) && this.registry.elementTarget(event.target))) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
    this.listen(window, "keydown", (event) => this.didChangeModifier(event), true);
    this.listen(window, "keyup", (event) => this.didChangeModifier(event), true);
    this.listen(window, "blur", () => this.clear());
    this.listen(element, "scroll", () => this.clear(), true);
    this.disposables.add(registry.onDidRemoveProvider(() => this.clear()));
    this.observer = new MutationObserver((records) => this.didMutate(records));
    this.observer.observe(element, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["data-hyperclick-revision", "data-hyperclick-boundary"],
    });
  }

  listen(target, name, handler, capture = false) {
    target.addEventListener(name, handler, capture);
    this.disposables.add(new Disposable(() => target.removeEventListener(name, handler, capture)));
  }

  didMutate(records) {
    const target = this.suggestion?.element || this.pendingElement;
    if (!target) return;
    if (
      !target.isConnected ||
      !this.element.contains(target) ||
      records.some(
        (record) =>
          record.target === target ||
          target.contains(record.target) ||
          (record.type === "childList" &&
            [...record.removedNodes, ...record.addedNodes].some(
              (node) => node === target || node.contains?.(target),
            )),
      )
    )
      this.clear();
  }

  pointedElement() {
    if (!this.pointerPosition) return null;
    const { clientX, clientY } = this.pointerPosition;
    const pointed = document.elementFromPoint(clientX, clientY);
    return pointed && this.element.contains(pointed) ? pointed : null;
  }

  didChangeModifier(event) {
    const focused = this.registry.elementTarget(event.target);
    if (
      event.type === "keydown" &&
      event.key === "Enter" &&
      !event.repeat &&
      focused &&
      this.element.contains(focused) &&
      (focused === document.activeElement || focused.contains(document.activeElement))
    ) {
      event.preventDefault();
      event.stopPropagation();
      void this.follow(focused);
      return;
    }
    if (!modifierHeld(event)) {
      this.clear();
      return;
    }
    if (this.pointerPosition) this.updateHover(this.pointedElement(), true);
  }

  didMouseMove(event) {
    this.pointerPosition = { clientX: event.clientX, clientY: event.clientY };
    if (!modifierHeld(event)) {
      this.clear();
      return;
    }
    this.updateHover(event.target);
  }

  updateHover(target, immediate = false) {
    const element = this.registry.elementTarget(target);
    if (!element || !this.element.contains(element)) {
      this.clear();
      return;
    }
    this.onClaimElement?.(element);
    if (this.suggestion?.element === element && this.isCurrent(this.suggestion)) return;
    if (this.pendingElement === element && !(immediate && this.hoverTimer !== null)) return;
    this.clear();
    this.pendingElement = element;
    const delay = immediate ? 0 : hoverDelay();
    if (delay <= 0) {
      void this.lookup(element, true);
      return;
    }
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      void this.lookup(element, true);
    }, delay);
  }

  async lookup(element, decorate) {
    this.cancelPending();
    const generation = this.generation;
    const revision = element.getAttribute("data-hyperclick-revision");
    const controller = new AbortController();
    this.controller = controller;
    this.pendingElement = element;
    const suggestion = await this.registry.getElementSuggestion(element, controller.signal);
    if (
      controller.signal.aborted ||
      this.destroyed ||
      this.generation !== generation ||
      revision !== element.getAttribute("data-hyperclick-revision")
    )
      return null;
    if (this.controller === controller) {
      this.controller = null;
      this.pendingElement = null;
    }
    if (!suggestion || !this.isCurrent(suggestion)) return null;
    if (decorate) {
      this.suggestion = suggestion;
      element.classList.add("hyperclick-dom-link");
    }
    return suggestion;
  }

  isCurrent(suggestion) {
    if (
      this.destroyed ||
      !suggestion?.element?.isConnected ||
      !this.element.contains(suggestion.element) ||
      !this.registry.isRegistered(suggestion.registration)
    )
      return false;
    try {
      return !suggestion.isCurrent || suggestion.isCurrent();
    } catch {
      return false;
    }
  }

  async follow(element) {
    this.clear();
    const suggestion = await this.lookup(element, false);
    if (!suggestion || !this.isCurrent(suggestion)) return false;
    try {
      await suggestion.callback();
      return true;
    } catch (error) {
      console.error(
        `hyperclick provider ${suggestion.provider.providerName ?? "(unnamed)"} failed to follow its suggestion:`,
        error,
      );
      return false;
    }
  }

  didMouseDown(event) {
    this.mouseGesture = null;
    if (!mouseActivation(event)) return;
    const element = this.registry.elementTarget(event.target);
    if (!element || !this.element.contains(element)) return;
    this.mouseGesture = element;
    this.onClaimElement?.(element);
    event.preventDefault();
    event.stopPropagation();
    void this.follow(element);
  }

  cancelPending() {
    this.generation++;
    if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.controller?.abort();
    this.controller = null;
    this.pendingElement = null;
  }

  clear() {
    this.cancelPending();
    this.suggestion?.element?.classList.remove("hyperclick-dom-link");
    this.suggestion = null;
  }

  destroy() {
    this.destroyed = true;
    this.clear();
    this.pointerPosition = null;
    this.mouseGesture = null;
    this.observer.disconnect();
    this.disposables.dispose();
  }
}

module.exports = HyperclickElement;
