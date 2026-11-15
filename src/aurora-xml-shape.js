(function attachAuroraXmlShape(root, factory) {
  const api = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.AuroraXmlShape = api;
  if (root.window) root.window.AuroraXmlShape = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAuroraXmlShape(root) {
  function resolveDOMParser(options) {
    return options?.DOMParser || root.DOMParser || root.window?.DOMParser;
  }

  const children = (node, name) => Array.from(node?.children || []).filter(child => child.tagName === name);
  const child = (node, name) => children(node, name)[0];

  function xmlParseError(doc) {
    const nodes = doc.getElementsByTagNameNS
      ? Array.from(doc.getElementsByTagNameNS('*', 'parsererror'))
      : [doc.querySelector('parsererror')].filter(Boolean);
    return nodes.find(node => node === doc.documentElement || node.namespaceURI === undefined
      || ['http://www.mozilla.org/newlayout/xml/parsererror.xml', 'http://www.w3.org/1999/xhtml'].includes(node.namespaceURI)) || null;
  }

  function validateAuroraXmlDocuments(docs, scopeLabel, options = {}) {
    const issues = [];
    const DOMParserCtor = resolveDOMParser(options);
    if (!DOMParserCtor) {
      return [{ type: 'xml', i: 0, field: null, msg: `${scopeLabel}: ValidatorModule - DOMParser is not available.` }];
    }

    const parser = new DOMParserCtor();
    const idLocations = new Map();
    const addIssue = (fileName, check, message) => {
      issues.push({ type: 'xml', i: 0, field: null, msg: `${scopeLabel} ${fileName}: ${check} - ${message}` });
    };

    docs.forEach(({ fileName, xml }) => {
      const doc = parser.parseFromString(xml, 'application/xml');
      const parseError = xmlParseError(doc);
      if (parseError) {
        addIssue(fileName, 'XmlParse', parseError.textContent.trim().slice(0, 180) || 'The parser reported invalid XML syntax.');
        return;
      }

      const rootElement = doc.documentElement;
      if (!rootElement || !['elements', 'index'].includes(rootElement.tagName)) {
        addIssue(fileName, 'RootShape', `Unexpected root '${rootElement?.tagName || '(none)'}'; expected 'elements' or 'index'.`);
        return;
      }

      const isIndex = rootElement.tagName === 'index';
      const prefix = isIndex ? 'Index' : 'Elements';
      const path = '/' + rootElement.tagName;
      const info = child(rootElement, 'info');
      if (!info) {
        addIssue(fileName, prefix + 'Info', 'Missing ' + path + '/info node.');
      } else {
        if (!isIndex && child(info, 'n')) addIssue(fileName, 'ElementsInfo', 'Uses /elements/info/n; Aurora metadata should use /elements/info/name.');
        const update = child(info, 'update');
        if (!update) {
          addIssue(fileName, prefix + 'Update', 'Missing ' + path + '/info/update node.');
        } else {
          if (!update.getAttribute('version')?.trim()) addIssue(fileName, prefix + 'Update', 'Update node is missing a non-empty version attribute.');
          children(update, 'file').forEach(fileNode => {
            const name = fileNode.getAttribute('name') || '';
            const url = fileNode.getAttribute('url') || '';
            if (!name.trim()) addIssue(fileName, prefix + 'Update', 'File node is missing a non-empty name attribute.');
            if (!url.trim()) addIssue(fileName, prefix + 'Update', `File node '${name}' is missing a non-empty url attribute.`);
          });
        }
      }

      if (isIndex) {
        const files = child(rootElement, 'files');
        if (!files) addIssue(fileName, 'IndexFiles', 'Missing /index/files node.');
        const names = new Set();
        for (const file of children(files, 'file')) {
          const name = file.getAttribute('name') || '';
          if (!name.trim()) addIssue(fileName, 'IndexFiles', 'File node is missing a non-empty name attribute.');
          if (!file.getAttribute('url')?.trim()) addIssue(fileName, 'IndexFiles', 'File node ' + name + ' is missing a non-empty url attribute.');
          if (names.has(name)) addIssue(fileName, 'IndexFiles', 'Index contains duplicate file name ' + name + '.');
          names.add(name);
        }
        return;
      }

      Array.from(rootElement.children).filter(node => node.tagName === 'element').forEach(element => {
        ['name', 'type', 'source', 'id'].forEach(attr => {
          if (!element.getAttribute(attr)?.trim()) {
            addIssue(fileName, 'ElementAttributes', `Element '${element.getAttribute('name') || ''}' is missing a non-empty '${attr}' attribute.`);
          }
        });

        const id = element.getAttribute('id');
        if (id) {
          if (!idLocations.has(id)) idLocations.set(id, []);
          idLocations.get(id).push(fileName);
        }

        if (element.getAttribute('type') === 'Class') {
          const hd = children(child(element, 'setters'), 'set').find(setter => setter.getAttribute('name') === 'hd');
          if (!hd || !hd.textContent.trim()) addIssue(fileName, 'ClassShape', `Class '${id}' is missing a non-empty hd setter.`);
          children(element, 'multiclass').forEach(multiclass => {
            if (!multiclass.getAttribute('id')?.trim()) addIssue(fileName, 'ClassShape', `Class '${id}' has a multiclass node without an id attribute.`);
          });
        }
      });
    });

    idLocations.forEach((locations, id) => {
      if (locations.length > 1) {
        const files = Array.from(new Set(locations));
        issues.push({ type: 'xml', i: 0, field: null, msg: `${scopeLabel}: DuplicateElementIds - duplicate element id '${id}' in ${files.join(', ')}` });
      }
    });

    return issues;
  }

  return {
    validateAuroraXmlDocuments,
    xmlParseError
  };
});
