# hyperclick

Follow the symbol under the pointer to its definition with a click.

Hold the modifier key and symbols become links: the one under the pointer is underlined, and clicking it goes wherever its provider decides — a definition, a declaration, a referenced file.

## Features

- **Click to follow**: hold the modifier, click a symbol, and land on its definition.
- **Live affordance**: the symbol under the pointer is underlined only when something can resolve it.
- **Pluggable providers**: any package can answer for the words it understands.
- **Language aware**: word boundaries follow the grammar's own non-word characters.
- **Scope filtering**: providers opt out of comments, strings, or any scope selector they name.
- **Keyboard path**: a command follows whatever the cursor is sitting on.

## Installation

To install `hyperclick` search for _hyperclick_ in the Install pane of the Lumine settings or run `lumine --install lumine-code/hyperclick`.

## Commands

Commands available in `atom-text-editor:not([mini])`:

- `hyperclick:confirm-cursor`: follow the symbol under the cursor.

## Usage

The modifier defaults to Alt because Ctrl (Cmd on macOS) is already the editor's add-a-cursor modifier — choosing it in the settings trades one for the other.

What a click does is up to whichever provider answered. With the bundled packages, that means jumping to a symbol's declaration; a language server, through `ide-client`, resolves it more precisely than a tags file can.

## Services

- **[hyperclick.provider](docs/hyperclick.provider.md)** (`^1.0.0`): consumed to let packages turn the words they understand into links.

## Customization

Restyle the affordance by adding CSS to your `styles.css`. For example, to draw a thicker, dashed underline:

```css
atom-text-editor .highlights .hyperclick .region {
  border-bottom: 2px dashed var(--text-color-warning);
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
