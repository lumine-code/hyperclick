// The editor's jasmine runner awaits a promise an `it`, `beforeEach` or
// `afterEach` returns, so nothing here has to wrap them. It used to, through a
// `waitsForPromise` that reported a rejection with
// `jasmine.getEnv().currentSpec.fail(error)` -- an API jasmine 6 does not have.
// A rejected spec promise therefore threw a TypeError inside the rejection
// handler and the real error was replaced by a bare "Timed out waiting for spec
// promise to resolve", which is how a CI failure here read for a while.

// Poll until `condition` holds. The ceiling matches the editor's own helper: a
// loaded CI runner -- the Windows one especially -- settles event-driven state
// markedly slower than a developer's machine, and a spec that gives up early
// there reports a timeout in place of whatever actually went wrong.
//
// `description` may be a function, called only when the wait gives up. A
// timeout is the one moment the state that caused it is still there to read,
// and on a runner nobody can attach a debugger to it is the only chance.
async function conditionPromise(
  condition,
  description = "anonymous condition",
  timeout = process.env.CI ? 30000 : 5000,
) {
  const startTime = Date.now();

  while (true) {
    await timeoutPromise(100);

    let result = condition();
    if (result instanceof Promise) result = await result;
    if (result) return;

    if (Date.now() - startTime > timeout) {
      const detail = typeof description === "function" ? description() : description;
      throw new Error(`Timed out waiting on ${detail}`);
    }
  }
}

function timeoutPromise(timeout) {
  return new Promise((resolve) => {
    global.setTimeout(resolve, timeout);
  });
}

module.exports = { conditionPromise, timeoutPromise };
