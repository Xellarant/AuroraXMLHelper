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

  function xmlSyntaxMessage(detail) {
    const text = String(detail || '');
    const location = text.match(/line(?: number)?\s*:?\s*(\d+)(?:\s*(?:at|,)?\s*column\s*:?\s*(\d+))?/i);
    const where = location ? ' near line ' + location[1] + (location[2] ? ', column ' + location[2] : '') : '';
    let action = 'Check for missing closing tags, quotes around attribute values, and unescaped & characters.';
    if (/mismatch|unexpected closing|opening and ending tag|does not match/i.test(text)) {
      action = 'Match each closing tag to its opening tag and check their nesting.';
    } else if (/entity|entityref|xmlParseEntityRef|xmlParseEntityDecl/i.test(text)) {
      action = 'Write a literal & as &amp; and check any other special characters in the text.';
    } else if (/attribute|attvalue|quote/i.test(text)) {
      action = 'Put each attribute value in matching quotes and check for duplicate attributes.';
    } else if (/premature|unclosed|unexpected end|no element found/i.test(text)) {
      action = 'Add the missing closing tags. If this file was cut off, copy or export the complete XML again.';
    }
    return 'The XML has a syntax error' + where + '. ' + action + ' Then check the XML again.';
  }

  function validateAuroraXmlDocuments(docs, scopeLabel, options = {}) {
    const issues = [];
    const DOMParserCtor = resolveDOMParser(options);
    if (!DOMParserCtor) {
      return [{ type: 'xml', i: 0, field: null, code: 'ValidatorModule', msg: `${scopeLabel}: XML checking is unavailable in this browser. Export a draft to keep your work, then refresh the app in a current browser and check again.` }];
    }

    const parser = new DOMParserCtor();
    const idLocations = new Map();
    const addIssue = (fileName, check, message) => {
      issues.push({ type: 'xml', i: 0, field: null, code: check, msg: `${scopeLabel} ${fileName}: ${message}` });
    };

    docs.forEach(({ fileName, xml }) => {
      const doc = parser.parseFromString(xml, 'application/xml');
      const parseError = xmlParseError(doc);
      if (parseError) {
        addIssue(fileName, 'XmlParse', xmlSyntaxMessage(parseError.textContent));
        return;
      }

      const rootElement = doc.documentElement;
      if (!rootElement || !['elements', 'index'].includes(rootElement.tagName)) {
        addIssue(fileName, 'RootShape', `The outermost XML tag must be <elements> or <index>. Replace '${rootElement?.tagName || '(none)'}' with the correct wrapper for this file.`);
        return;
      }

      const isIndex = rootElement.tagName === 'index';
      const prefix = isIndex ? 'Index' : 'Elements';
      const path = '/' + rootElement.tagName;
      const info = child(rootElement, 'info');
      if (!info) {
        addIssue(fileName, prefix + 'Info', 'Missing ' + path + '/info. Add an <info> block directly inside <' + rootElement.tagName + '>; a built-in template shows the required layout.');
      } else {
        if (!isIndex && child(info, 'n')) addIssue(fileName, 'ElementsInfo', 'Replace <n> with <name> inside <info> so Aurora can read the source name.');
        const update = child(info, 'update');
        if (!update) {
          addIssue(fileName, prefix + 'Update', 'Missing ' + path + '/info/update. Add an <update> block inside <info>; copy its layout from a built-in template.');
        } else {
          if (!update.getAttribute('version')?.trim()) addIssue(fileName, prefix + 'Update', 'Add a version to <update>, such as version="0.1.0".');
          children(update, 'file').forEach(fileNode => {
            const name = fileNode.getAttribute('name') || '';
            const url = fileNode.getAttribute('url') || '';
            if (!name.trim()) addIssue(fileName, prefix + 'Update', 'Enter a file name in the <file> name attribute inside <update>, such as name="spells.xml".');
            if (!url.trim()) addIssue(fileName, prefix + 'Update', `Enter the file address in the url attribute for '${name || 'unnamed file'}' inside <update>. Use its file name for a local file.`);
          });
        }
      }

      if (isIndex) {
        const files = child(rootElement, 'files');
        if (!files) addIssue(fileName, 'IndexFiles', 'Missing /index/files. Add a <files> block inside <index> and list the XML files it should load.');
        const names = new Set();
        for (const file of children(files, 'file')) {
          const name = file.getAttribute('name') || '';
          if (!name.trim()) addIssue(fileName, 'IndexFiles', 'Enter a name for each <file> listed inside <files>.');
          if (!file.getAttribute('url')?.trim()) addIssue(fileName, 'IndexFiles', 'Enter the url for ' + (name || 'the unnamed file') + ' inside <files>. Use its file name for a local file.');
          if (names.has(name)) addIssue(fileName, 'IndexFiles', 'The index lists ' + name + ' more than once. Remove the duplicate or give each file a unique name.');
          names.add(name);
        }
        return;
      }

      Array.from(rootElement.children).filter(node => node.tagName === 'element').forEach(element => {
        ['name', 'type', 'source', 'id'].forEach(attr => {
          if (!element.getAttribute(attr)?.trim()) {
            addIssue(fileName, 'ElementAttributes', `Enter the '${attr}' attribute on the opening <element> tag for '${element.getAttribute('name') || 'unnamed entry'}'. Aurora needs name, type, source, and id for each entry.`);
          }
        });

        const id = element.getAttribute('id');
        if (id) {
          if (!idLocations.has(id)) idLocations.set(id, []);
          idLocations.get(id).push(fileName);
        }

        if (element.getAttribute('type') === 'Class') {
          const hd = children(child(element, 'setters'), 'set').find(setter => setter.getAttribute('name') === 'hd');
          if (!hd || !hd.textContent.trim()) addIssue(fileName, 'ClassShape', `Class '${id}' needs a hit die. Add <set name="hd">d8</set> inside its <setters> block, replacing d8 with the source's hit die.`);
          children(element, 'multiclass').forEach(multiclass => {
            if (!multiclass.getAttribute('id')?.trim()) addIssue(fileName, 'ClassShape', `Add a unique id attribute to the <multiclass> block in class '${id}'.`);
          });
        }
      });
    });

    idLocations.forEach((locations, id) => {
      if (locations.length > 1) {
        const files = Array.from(new Set(locations));
        issues.push({ type: 'xml', i: 0, field: null, code: 'DuplicateElementIds', msg: `${scopeLabel}: The element ID '${id}' is used more than once in ${files.join(', ')}. Give each entry a unique ID and update references to it.` });
      }
    });

    return issues;
  }

  return {
    validateAuroraXmlDocuments,
    xmlParseError,
    xmlSyntaxMessage
  };
});
