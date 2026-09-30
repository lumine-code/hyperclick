# hyperclick.provider

Turns a word in the editor into something clickable: the provider is asked about a range, and answers with a callback to run if the user follows it.

|             |                                                           |
| ----------- | --------------------------------------------------------- |
| Version     | `1.0.0`                                                   |
| Provided by | `provideHyperclick()` returning one provider              |
| Consumed by | `consumeHyperclick(provider)` returning a `Disposable`    |
| Owner       | [`hyperclick`](https://github.com/lumine-code/hyperclick) |

`hyperclick` watches the pointer while the user holds Alt, works out the word underneath, and asks each provider — highest priority first — whether it means anything. Pressing Alt checks the last pointer position immediately, without waiting for the hover delay. The first provider to answer wins: its range is underlined, and its callback runs on left Alt-click or through the keyboard navigation command.

## Registration

In your `package.json`:

```json
{
  "providedServices": {
    "hyperclick.provider": {
      "versions": { "1.0.0": "provideHyperclick" }
    }
  }
}
```

Return one provider, or an array of them.

## Contract

```ts
type HyperclickProvider = {
  getSuggestionForWord(
    editor: TextEditor,
    text: string,
    range: Range,
  ): Suggestion | undefined | Promise<Suggestion | undefined>;

  priority?: number;
  providerName?: string;
  disableForSelector?: string;
};

type Suggestion = {
  range: Range | Range[];
  callback(): void | Promise<unknown>;
};
```

Required:

| Member                                      | Description                                               |
| ------------------------------------------- | --------------------------------------------------------- |
| `getSuggestionForWord(editor, text, range)` | Return a suggestion, or nothing to decline. May be async. |

Optional:

| Member               | Description                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `priority`           | Higher is asked first, and the first answer wins. Defaults to `0`; the bundled providers use `1`. |
| `providerName`       | Names the provider in diagnostics when it throws.                                                 |
| `disableForSelector` | A comma-separated scope selector. Ranges whose scope chain matches are never offered to you.      |

The suggestion's `range` is what gets underlined, and does not have to equal the range you were asked about. Give an array to underline several ranges as one link. `callback` runs when the user follows it and may return a Promise. Synchronous errors and Promise rejections are logged with the provider's name; the returned value does not change whether the click was claimed.

## Minimal example

```js
module.exports = {
  provideHyperclick() {
    return {
      priority: 1,
      providerName: "my-package",
      disableForSelector: ".comment, .string",
      getSuggestionForWord(editor, text, range) {
        if (!editor.getGrammar().scopeName.startsWith("source.mylang")) return;
        const target = resolve(editor, text);
        if (!target) return;
        return {
          range,
          callback: () => lumine.workspace.open(target.path, { initialLine: target.row }),
        };
      },
    };
  },
};
```

## Behavior

**Declining is the common case, so make it cheap.** `getSuggestionForWord` is called as the pointer travels, not on click. Check the grammar and the token before doing any real work.

**You are only asked about words.** Whitespace, punctuation runs, and positions past the end of a line never reach a provider — the word is split on the editor's scoped `nonWordCharacters` setting, so what counts as one word follows the language.

**`disableForSelector` is enforced by the consumer.** You do not need to test the scope chain yourself; a provider that also does is merely redundant.

**Filter out the trivial answer.** `symbol` drops a result whose position equals the position asked about, so holding Alt over a definition produces no affordance at all rather than a link to where the pointer already is.

**A late answer is dropped.** Once the pointer moves to another word, leaves the editor, Alt is released, or the window loses focus, the request is aborted and whatever it eventually resolves is discarded. Going async is fine; holding state that assumes your answer was used is not.

**Multiple results are yours to present.** The contract carries one callback, not a list. A provider with several candidates should open its own UI from the callback, as `symbol` does when more than one declaration matches.

## Teardown

`consumeHyperclick` returns a `Disposable` that unregisters the provider. Unregistering removes its displayed links, discards pending answers, and prevents cached callbacks from running. Registering the same provider object again creates a new registration and cannot revive an old answer. Nothing else is called on teardown: a provider should assume it will simply stop being asked.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
