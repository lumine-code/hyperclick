const { Range } = require("lumine");

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe("hyperclick provider registrations", () => {
  let registry, editor, range, callback, provider;

  beforeEach(() => {
    const ProviderRegistry = require("../lib/provider-registry");
    registry = new ProviderRegistry();
    editor = lumine.workspace.buildTextEditor();
    editor.setText("alpha\n");
    range = new Range([0, 0], [0, 5]);
    callback = jasmine.createSpy("follow alpha");
    provider = {
      providerName: "stub",
      getSuggestionForWord: jasmine
        .createSpy("getSuggestionForWord")
        .and.returnValue({ range, callback }),
    };
  });

  afterEach(() => {
    registry.destroy();
    editor.destroy();
  });

  function lookup() {
    return registry.getSuggestion(editor, "alpha", range);
  }

  it("discards an answer resolved after its registration was disposed", async () => {
    const answer = deferred();
    provider.getSuggestionForWord.and.returnValue(answer.promise);
    const subscription = registry.add(provider);
    const request = lookup();
    expect(provider.getSuggestionForWord).toHaveBeenCalledTimes(1);

    subscription.dispose();
    answer.resolve({ range, callback });

    expect(await request).toBeNull();
    expect(registry.size).toBe(0);
    expect(callback).not.toHaveBeenCalled();
  });

  it("asks the next provider when an awaiting registration is removed", async () => {
    const answer = deferred();
    provider.priority = 5;
    provider.getSuggestionForWord.and.returnValue(answer.promise);
    const nextCallback = jasmine.createSpy("follow with next provider");
    const nextProvider = {
      priority: 1,
      getSuggestionForWord: jasmine
        .createSpy("next provider")
        .and.returnValue({ range, callback: nextCallback }),
    };
    const subscription = registry.add(provider);
    registry.add(nextProvider);
    const request = lookup();

    subscription.dispose();
    answer.resolve({ range, callback });
    const suggestion = await request;

    expect(nextProvider.getSuggestionForWord).toHaveBeenCalledTimes(1);
    expect(suggestion.provider).toBe(nextProvider);
    expect(suggestion.callback).toBe(nextCallback);
    expect(registry.isRegistered(suggestion.registration)).toBe(true);
  });

  it("keeps an old answer invalid when the same provider object is registered again", async () => {
    const answer = deferred();
    const newCallback = jasmine.createSpy("follow new registration");
    provider.getSuggestionForWord.and.returnValues(answer.promise, {
      range,
      callback: newCallback,
    });
    const oldSubscription = registry.add(provider);
    const oldRequest = lookup();

    oldSubscription.dispose();
    registry.add(provider);
    answer.resolve({ range, callback });

    expect(await oldRequest).toBeNull();
    const suggestion = await lookup();
    expect(registry.size).toBe(1);
    expect(suggestion.callback).toBe(newCallback);
    expect(registry.isRegistered(suggestion.registration)).toBe(true);
    expect(provider.getSuggestionForWord).toHaveBeenCalledTimes(2);
  });

  it("disposes exactly its own registration when a provider object is registered twice", async () => {
    const firstSubscription = registry.add(provider);
    const secondSubscription = registry.add(provider);
    const firstSuggestion = await lookup();

    secondSubscription.dispose();

    expect(registry.size).toBe(1);
    expect(registry.isRegistered(firstSuggestion.registration)).toBe(true);
    expect((await lookup()).registration).toBe(firstSuggestion.registration);

    firstSubscription.dispose();
    expect(registry.size).toBe(0);
    expect(registry.isRegistered(firstSuggestion.registration)).toBe(false);
  });

  it("notifies removal once with the registration that became invalid", async () => {
    const removed = jasmine.createSpy("removed registration");
    registry.onDidRemoveProvider(removed);
    const subscription = registry.add(provider);
    const suggestion = await lookup();

    subscription.dispose();
    subscription.dispose();

    expect(removed).toHaveBeenCalledOnceWith(suggestion.registration);
    expect(registry.isRegistered(suggestion.registration)).toBe(false);
  });

  it("stops removal notifications when their subscription is disposed", () => {
    const removed = jasmine.createSpy("removed registration");
    const observer = registry.onDidRemoveProvider(removed);
    const subscription = registry.add(provider);

    observer.dispose();
    subscription.dispose();

    expect(removed).not.toHaveBeenCalled();
  });

  it("invalidates pending and unasked registrations when the registry is destroyed", async () => {
    const answer = deferred();
    provider.priority = 5;
    provider.getSuggestionForWord.and.returnValue(answer.promise);
    const nextProvider = {
      priority: 1,
      getSuggestionForWord: jasmine
        .createSpy("provider after destroy")
        .and.returnValue({ range, callback }),
    };
    registry.add(provider);
    registry.add(nextProvider);
    const request = lookup();

    registry.destroy();
    answer.resolve({ range, callback });

    expect(await request).toBeNull();
    expect(registry.size).toBe(0);
    expect(nextProvider.getSuggestionForWord).not.toHaveBeenCalled();
  });
});
