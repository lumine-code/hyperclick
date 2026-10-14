// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-gfm", "language-hyperlink", "link"],
  viewport: { width: 1100, height: 500 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("more/README.md");
    await lumine.project.setPaths([fixture("more")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Recognize a documentation URL as a clickable link in the editor.",
      timeout: 60000,
      async run() {},
      async afterPointerMove(context) {
        const { lumine, state } = context;
        const h = lumine.packages
          .getActivePackage("hyperclick")
          .mainModule.editors.get(state.editor);
        if (!h) throw Error("No hyperclick controller");
        await h.lookup(new (require("lumine").Range)([4, 5], [4, 10]));
      },
      ready() {
        return Boolean(document.querySelector(".hyperclick"));
      },
    },
  ],
  async cleanup() {},
};
