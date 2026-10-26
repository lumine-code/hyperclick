const { Point, Range } = require("lumine");
const MAX_WORD_UNITS = 4096;

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

// Mirrors `Cursor::wordRegExp`, minus its non-word-character alternative: a run
// of punctuation is not something a provider can resolve, and offering it as a
// target would underline every bracket the pointer crossed.
function wordRegExpFor(editor, position) {
  const nonWordCharacters = escapeRegExp(editor.getNonWordCharacters(position) ?? "");
  return new RegExp(`[^\\s${nonWordCharacters}]+`, "g");
}

/**
 * The buffer range of the word at `position`, or `null` when the position sits
 * on whitespace, on punctuation, or past the end of the line.
 *
 * The editor clamps a mouse position into the visible text area, so a pointer
 * in the empty space to the right of a short line reports the line's last
 * column. Rejecting a position at or past the line's end keeps that from
 * lighting up the final word of every line the pointer passes.
 */
function wordRangeAt(editor, position) {
  position = Point.fromObject(position);
  const buffer = editor.getBuffer();
  const length = buffer.lineLengthForRow(position.row);
  if (!Number.isFinite(length) || position.column < 0 || position.column >= length) return null;
  const from = Math.max(0, position.column - MAX_WORD_UNITS - 1);
  const to = Math.min(length, position.column + MAX_WORD_UNITS + 1);
  const line = editor.getTextInBufferRange([
    [position.row, from],
    [position.row, to],
  ]);

  const regex = wordRExpCache(editor, position);
  regex.lastIndex = 0;

  let match;
  while ((match = regex.exec(line)) !== null) {
    const start = from + match.index;
    const end = start + match[0].length;
    if (start > position.column) return null;
    if (end > position.column) {
      if (
        match[0].length > MAX_WORD_UNITS ||
        (from > 0 && start === from) ||
        (to < length && end === to)
      )
        return null;
      return new Range(new Point(position.row, start), new Point(position.row, end));
    }
  }
  return null;
}

// The regex depends only on the scoped `editor.nonWordCharacters` setting, so
// recomputing it for every pointer move would rebuild the same object dozens of
// times a second.
const CACHE = new WeakMap();

function wordRExpCache(editor, position) {
  const nonWordCharacters = editor.getNonWordCharacters(position) ?? "";
  const cached = CACHE.get(editor);
  if (cached && cached.nonWordCharacters === nonWordCharacters) return cached.regex;
  const regex = wordRegExpFor(editor, position);
  CACHE.set(editor, { nonWordCharacters, regex });
  return regex;
}

module.exports = { wordRangeAt, MAX_WORD_UNITS };
