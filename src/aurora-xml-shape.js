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
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        addIssue(fileName, 'XmlParse', parseError.textContent.trim().slice(0, 180));
        return;
      }

      const rootElement = doc.documentElement;
      if (!rootElement || rootElement.tagName !== 'elements') {
        addIssue(fileName, 'RootShape', `Unexpected root '${rootElement?.tagName || '(none)'}'; expected 'elements'.`);
        return;
      }

      const info = rootElement.querySelector('info');
      if (!info) {
        addIssue(fileName, 'ElementsInfo', 'Missing /elements/info node.');
      } else {
        if (info.querySelector('n')) addIssue(fileName, 'ElementsInfo', 'Uses /elements/info/n; Aurora metadata should use /elements/info/name.');
        const update = info.querySelector('update');
        if (!update) {
          addIssue(fileName, 'ElementsUpdate', 'Missing /elements/info/update node.');
        } else {
          if (!update.getAttribute('version')?.trim()) addIssue(fileName, 'ElementsUpdate', 'Update node is missing a non-empty version attribute.');
          Array.from(update.querySelectorAll('file')).forEach(fileNode => {
            const name = fileNode.getAttribute('name') || '';
            const url = fileNode.getAttribute('url') || '';
            if (!name.trim()) addIssue(fileName, 'ElementsUpdate', 'File node is missing a non-empty name attribute.');
            if (!url.trim()) addIssue(fileName, 'ElementsUpdate', `File node '${name}' is missing a non-empty url attribute.`);
          });
        }
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
          const hd = element.querySelector('setters > set[name="hd"]');
          if (!hd || !hd.textContent.trim()) addIssue(fileName, 'ClassShape', `Class '${id}' is missing a non-empty hd setter.`);
          Array.from(element.querySelectorAll('multiclass')).forEach(multiclass => {
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
    validateAuroraXmlDocuments
  };
});
