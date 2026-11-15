const assert = require('node:assert/strict');
const { validateAuroraXmlDocuments } = require('../src/aurora-xml-shape');

function node(tagName, attrs = {}, children = [], text = '') {
  return { tagName, children, textContent: text, getAttribute(name) { return attrs[name] || ''; } };
}
function metadata() {
  return node('info', {}, [node('name', {}, [], 'Fixture'), node('update', { version: '1.0' },
    [node('file', { name: 'fixture.xml', url: 'fixture.xml' })])]);
}
function validate(root) {
  class DOMParser {
    parseFromString() { return { querySelector() { return null; }, documentElement: root }; }
  }
  return validateAuroraXmlDocuments([{ fileName: 'fixture.xml', xml: 'DOM fixture' }], 'Browser shape', { DOMParser });
}
const messages = root => validate(root).map(issue => issue.msg).join('\n');

test('browser shape checks require metadata at its actual parent rather than inside content', () => {
  const nested = node('elements', {}, [node('element', { name: 'Nested', type: 'Feat', source: 'X', id: 'ID_NESTED' }, [metadata()])]);
  assert.match(messages(nested), /ElementsInfo - Missing \/elements\/info/);
  const nestedUpdate = node('elements', {}, [node('info', {}, [node('description', {}, [metadata().children[1]])])]);
  assert.match(messages(nestedUpdate), /ElementsUpdate - Missing \/elements\/info\/update/);
  assert.equal(validate(node('elements', {}, [metadata()])).length, 0);
});

test('browser class checks do not accept nested feature setters as class hit dice', () => {
  const nested = node('element', { name: 'Class', type: 'Class', source: 'X', id: 'ID_CLASS' },
    [node('description', {}, [node('setters', {}, [node('set', { name: 'hd' }, [], 'd8')])])]);
  assert.match(messages(node('elements', {}, [metadata(), nested])), /ClassShape.*missing a non-empty hd/);
});

test('browser shape checks support Aurora index files and flag their missing file details', () => {
  const valid = node('index', {}, [metadata(), node('files', {}, [node('file', { name: 'spells.xml', url: 'spells.xml' })])]);
  assert.equal(validate(valid).length, 0);
  assert.match(messages(node('index', {}, [metadata()])), /IndexFiles - Missing \/index\/files/);
  const invalid = node('index', {}, [metadata(), node('files', {}, [
    node('file', { name: 'same.xml' }), node('file', { name: 'same.xml', url: 'same.xml' }), node('file', { url: 'unnamed.xml' })
  ])]);
  const found = messages(invalid);
  assert.match(found, /missing a non-empty url/);
  assert.match(found, /missing a non-empty name/);
  assert.match(found, /duplicate file name same.xml/);
});

test('shape validation recognizes both Mozilla and nested Chromium XHTML parser-error documents', () => {
  for (const namespaceURI of ['http://www.mozilla.org/newlayout/xml/parsererror.xml', 'http://www.w3.org/1999/xhtml']) {
    class DOMParser {
      parseFromString() {
        const error = { namespaceURI, textContent: 'Unexpected closing tag.' };
        return { documentElement: node('elements'), querySelector() { return error; }, getElementsByTagNameNS() { return [error]; } };
      }
    }
    const found = validateAuroraXmlDocuments([{ fileName: 'broken.xml', xml: '<elements><element></elements>' }], 'Browser shape', { DOMParser });
    assert.equal(found.length, 1);
    assert.match(found[0].msg, /XmlParse - Unexpected closing tag/);
  }
});
