const { CompositeDisposable } = require("lumine");

const HyperclickEditor = require("./hyperclick-editor");
const ProviderRegistry = require("./provider-registry");

module.exports = {
  activate() {
    this.registry = new ProviderRegistry();
    this.editors = new Map();
    // Assigned before observing: `observeTextEditors` calls back synchronously
    // for every editor already open, and `watch` adds to this.
    this.subscriptions = new CompositeDisposable();

    this.subscriptions.add(
      lumine.workspace.observeTextEditors((editor) => this.watch(editor)),
      lumine.commands.add("lumine-text-editor:not([mini])", {
        "hyperclick:confirm-cursor": (event) => {
          const editorView = event.currentTarget;
          const controller = this.editors.get(editorView.getModel());
          if (!controller) return;
          controller.confirmCursor().then((followed) => {
            // Nothing under the cursor is something another binding may want.
            if (!followed) event.abortKeyBinding();
          });
        },
      }),
    );
  },

  deactivate() {
    for (const controller of this.editors.values()) controller.destroy();
    this.editors.clear();
    this.subscriptions?.dispose();
    this.subscriptions = null;
    this.registry = null;
  },

  watch(editor) {
    if (editor.isMini() || this.editors.has(editor)) return;
    const controller = new HyperclickEditor(editor, this.registry);
    this.editors.set(editor, controller);
    this.subscriptions.add(
      editor.onDidDestroy(() => {
        this.editors.get(editor)?.destroy();
        this.editors.delete(editor);
      }),
    );
  },

  consumeHyperclick(provider) {
    const providers = Array.isArray(provider) ? provider : [provider];
    const disposables = providers.map((entry) => this.registry.add(entry));
    return new CompositeDisposable(...disposables);
  },
};
