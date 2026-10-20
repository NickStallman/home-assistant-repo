const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('external-editor can create, read and remove a file with the patched tmp dependency', () => {
  const {ExternalEditor} = require('external-editor');
  const editor = new ExternalEditor('synthetic editor content', {mode: 0o600});
  const filename = editor.tempFile;
  try {
    assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
    fs.writeFileSync(filename, 'edited content');
    // Exercise the file lifecycle without launching an interactive editor.
    editor.readTemporaryFile();
    assert.equal(editor.text, 'edited content');
  } finally {
    editor.cleanup();
  }
  assert.equal(fs.existsSync(filename), false);
});
