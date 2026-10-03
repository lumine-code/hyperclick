# hyperclick

Follow the symbol under the pointer to its definition with a click.

Hold Alt and symbols become links: the one under the pointer is underlined, the mouse cursor becomes a pointer, and left-clicking it goes wherever its provider decides — a definition, a declaration, a referenced file.

## Features

- **Click to follow**: hold Alt, left-click a symbol, and land on its definition.
- **Live affordance**: pressing or releasing Alt updates the underline and mouse cursor even when the mouse stays still, and moving with Alt held updates the target.
- **Pluggable providers**: any package can answer for the words it understands.
- **Rendered targets**: registered output locations use the same Alt gesture and hover delay as source symbols, including dock panels and notebook results.
- **Language aware**: word boundaries follow the grammar's own non-word characters.
- **Scope filtering**: providers opt out of comments, strings, or any scope selector they name.
- **Keyboard path**: a command follows whatever the cursor is sitting on.

## Installation

To install `hyperclick` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/hyperclick`.

## Commands

Commands available in `lumine-text-editor:not([mini])`:

- `hyperclick:confirm-cursor`: follow the symbol under the cursor.

## Usage

Without Alt, moving the mouse shows no link style and clicking keeps the editor's normal behavior. Pressing Alt checks the symbol under a stationary mouse immediately; releasing it removes the link style and cancels any pending answer. Ctrl and Cmd keep their normal editor behavior.

What a click does is up to whichever provider answered. With the bundled packages, that means jumping to a symbol's declaration; a language server, through `ide-client`, resolves it more precisely than a tags file can.

## Services

- [`hyperclick.provider`](docs/hyperclick.provider.md): consumed to let packages resolve source words and rendered locations.

## Customization

Restyle the affordance by adding CSS to your `styles.css`. For example, to draw a thicker, dashed underline:

```css
lumine-text-editor .highlights .hyperclick .region {
  border-bottom: 2px dashed var(--text-color-warning);
}
```

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
