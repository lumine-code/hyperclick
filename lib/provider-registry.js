const { Disposable, Emitter } = require("lumine");

// Keeps the registered providers in priority order and asks them, best first,
// who wants to claim a word.
class ProviderRegistry {
  constructor() {
    this.registrations = [];
    this.emitter = new Emitter();
  }

  add(provider) {
    const word = typeof provider?.getSuggestionForWord === "function";
    const dom =
      typeof provider?.getSuggestionForElement === "function" &&
      typeof provider.elementSelector === "string" &&
      provider.elementSelector.trim();
    if (!word && !dom) {
      console.warn("hyperclick ignored a provider with no valid word or element lookup:", provider);
      return new Disposable(() => {});
    }
    const registration = { provider };
    this.registrations.push(registration);
    // Highest priority first; registration order breaks ties, so a provider
    // that arrives later never displaces an equal-priority incumbent.
    this.registrations.sort((a, b) => (b.provider.priority ?? 0) - (a.provider.priority ?? 0));
    return new Disposable(() => this.remove(registration));
  }

  remove(registration) {
    const index = this.registrations.indexOf(registration);
    if (index === -1) return;
    this.registrations.splice(index, 1);
    this.emitter.emit("did-remove-provider", registration);
  }

  onDidRemoveProvider(callback) {
    return this.emitter.on("did-remove-provider", callback);
  }

  isRegistered(registration) {
    return this.registrations.includes(registration);
  }

  destroy() {
    this.registrations.length = 0;
    this.emitter.dispose();
  }

  get size() {
    return this.registrations.length;
  }

  /**
   * Ask each provider in turn for a suggestion covering `range`. The first one
   * to answer wins — providers decline by returning nothing, which is the
   * common case and must stay cheap.
   *
   * @param   {TextEditor} editor The editor the word lives in.
   * @param   {String} text The word's text.
   * @param   {Range} range The word's buffer range.
   * @param   {AbortSignal} signal Aborted when the pointer moves on; a
   *   suggestion resolved afterwards is dropped.
   * @returns {Promise<Object|null>} The winning suggestion, with the provider
   *   that gave it attached as `provider`.
   */
  async getSuggestion(editor, text, range, signal) {
    // A removal during an async lookup must not shift the next provider out
    // from under the iteration. Each entry also identifies this particular
    // registration, even if the same provider object is registered again.
    for (const registration of [...this.registrations]) {
      if (signal?.aborted) return null;
      if (!this.isRegistered(registration)) continue;
      const { provider } = registration;
      if (typeof provider.getSuggestionForWord !== "function") continue;
      if (this.isDisabledAt(provider, editor, range.start)) continue;

      let suggestion;
      try {
        suggestion = await provider.getSuggestionForWord(editor, text, range);
      } catch (error) {
        console.error(`hyperclick provider ${provider.providerName ?? "(unnamed)"} failed:`, error);
        continue;
      }

      if (signal?.aborted) return null;
      if (!this.isRegistered(registration)) continue;
      if (!suggestion || typeof suggestion.callback !== "function") continue;
      if (!suggestion.range) continue;
      return { ...suggestion, provider, registration };
    }
    return null;
  }

  elementFor(target, registration) {
    const { provider } = registration;
    if (
      typeof provider.getSuggestionForElement !== "function" ||
      typeof provider.elementSelector !== "string"
    )
      return null;
    try {
      return target?.closest?.(provider.elementSelector) || null;
    } catch {
      return null;
    }
  }

  elementTarget(target) {
    for (const registration of this.registrations) {
      const element = this.elementFor(target, registration);
      if (element) return element;
    }
    return null;
  }

  isElementBoundary(target) {
    return Boolean(target?.closest?.("[data-hyperclick-boundary]") || this.elementTarget(target));
  }

  async getElementSuggestion(target, signal) {
    for (const registration of [...this.registrations]) {
      if (signal?.aborted) return null;
      if (!this.isRegistered(registration)) continue;
      const element = this.elementFor(target, registration);
      if (!element?.isConnected) continue;
      const { provider } = registration;
      let suggestion;
      try {
        suggestion = await provider.getSuggestionForElement(element, { signal });
      } catch (error) {
        if (!signal?.aborted)
          console.error(
            `hyperclick provider ${provider.providerName ?? "(unnamed)"} failed:`,
            error,
          );
        continue;
      }
      if (signal?.aborted) return null;
      if (!this.isRegistered(registration) || !element.isConnected) continue;
      if (suggestion?.element !== element || typeof suggestion.callback !== "function") continue;
      if (suggestion.isCurrent !== undefined && typeof suggestion.isCurrent !== "function")
        continue;
      return { ...suggestion, provider, registration };
    }
    return null;
  }

  // A provider naming a `disableForSelector` opts out wherever the scope chain
  // matches — inside comments and strings, typically. Enforced here so every
  // provider gets the same treatment whether or not it also checks itself.
  isDisabledAt(provider, editor, position) {
    const selector = provider.disableForSelector;
    if (!selector) return false;
    const scopeChain = editor.scopeDescriptorForBufferPosition(position).getScopeChain();
    try {
      return scopeChain.split(/\s+/).some((scope) => this.matchesSelector(selector, scope));
    } catch {
      return false;
    }
  }

  matchesSelector(selector, scope) {
    // Scopes arrive dot-joined (`.source.js.comment.line`); an element that
    // ends with a listed selector's tail is a match.
    return selector
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .some((part) => {
        const tail = part.split(/\s+/).pop();
        return scope === tail || scope.startsWith(`${tail}.`);
      });
  }
}

module.exports = ProviderRegistry;
