const { CompositeDisposable } = require("lumine");

const HyperclickEditor = require("./hyperclick-editor");
const HyperclickElement = require("./hyperclick-element");
const ProviderRegistry = require("./provider-registry");

module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "hyperclick",
      tips: [
        "{% if keys['hyperclick:confirm-cursor'] %}You can follow the symbol under the cursor to its definition with {{ 'hyperclick:confirm-cursor' | keystroke }}{% else %}You can hold Alt and click a symbol to jump to its definition.{% endif %}",
      ],
    };
  },

  activate() {
    this.registry = new ProviderRegistry();
    this.editors = new Map();
    // Assigned before observing: `observeTextEditors` calls back synchronously
    // for every editor already open, and `watch` adds to this.
    this.subscriptions = new CompositeDisposable();
    this.elementController = new HyperclickElement(
      lumine.views.getView(lumine.workspace),
      this.registry,
      {
        onClaimElement: (element) => {
          const editorElement = element.closest("lumine-text-editor");
          const controller = this.editors.get(editorElement?.getModel?.());
          if (controller) {
            controller.pointerPosition = null;
            controller.clear();
          }
        },
      },
    );

    this.subscriptions.add(
      // The registry rather than the workspace: embedded editors — a notebook
      // cell — are registered there without being pane items, and hyperclick
      // works wherever the pointer does.
      lumine.textEditors.observe((editor) => this.watch(editor)),
      lumine.textEditors.onDidRemoveEditor((editor) => this.unwatch(editor)),
      lumine.commands.add("lumine-text-editor:not([mini])", {
        "hyperclick:confirm-cursor": {
          description: "Follow whatever the cursor is on, as a click would.",
          didDispatch: (event) => {
            const editorView = event.currentTarget;
            const controller = this.editors.get(editorView.getModel());
            if (!controller) return;
            controller.confirmCursor().then((followed) => {
              // Nothing under the cursor is something another binding may want.
              if (!followed) event.abortKeyBinding();
            });
          },
        },
      }),
    );
  },

  deactivate() {
    this.elementController?.destroy();
    this.elementController = null;
    for (const controller of this.editors.values()) controller.destroy();
    this.editors.clear();
    this.subscriptions?.dispose();
    this.subscriptions = null;
    this.registry?.destroy();
    this.registry = null;
  },

  watch(editor) {
    if (editor.isMini() || this.editors.has(editor)) return;
    const controller = new HyperclickEditor(editor, this.registry);
    this.editors.set(editor, controller);
  },

  unwatch(editor) {
    const controller = this.editors.get(editor);
    if (!controller) return;
    this.editors.delete(editor);
    controller.destroy();
  },

  consumeHyperclick(provider) {
    const providers = Array.isArray(provider) ? provider : [provider];
    const disposables = providers.map((entry) => this.registry.add(entry));
    return new CompositeDisposable(...disposables);
  },
};
