(function attachUserMessages(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AuroraUserMessages = api;
  if (root.window) root.window.AuroraUserMessages = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createUserMessages() {
  // Only messages written for users may pass through. Browser/library exception
  // text can contain implementation details, file contents, or an opaque code.
  function error(message) {
    return Object.assign(new Error(message), { userMessage: message });
  }

  const fallbacks = {
    pdf: 'The PDF could not be read. Open it in a PDF reader and save a new copy, then select that copy and try Parse PDF again.',
    'xml-read': 'The browser could not read the XML files. Select them again and try Inspect XML. If a file still fails, open it in a text editor and save a new copy.',
    'xml-inspect': 'The XML could not be checked. Export a draft to keep your work, then refresh the app and try Inspect XML again.',
    'xml-repair': 'The repair could not be completed. Inspect XML again and review the selected repairs before retrying. Export a draft before refreshing the app.',
    clipboard: 'The browser could not copy the XML. Select the XML text and copy it manually, or use the download button to save it as a file.',
    zip: 'The ZIP file could not be created. Try Download ZIP again, or use Single XML. Export a draft to keep your work before refreshing the app.',
    'repair-download': 'The repaired XML could not be prepared for download. Try Download Fixed XML again. Export a draft to keep the repaired files before refreshing the app.',
    'xml-download': 'The XML could not be prepared for download. Copy the XML text instead, or export a draft before refreshing and trying again.',
    'draft-save': 'Automatic saving stopped. Your open work is still available. Use Export draft to save a backup, then refresh the app and try again.',
    'draft-import': 'This draft file could not be opened. Select an Aurora XML Helper draft exported with Export draft, or try another backup. Your current workspace has been kept.',
    'draft-export': 'The draft backup could not be created. Try Export draft again. If it still fails, download your XML files separately before leaving the app.',
    'draft-clear': 'The saved draft could not be cleared. Export a draft to back up your open work, then try Clear saved draft again.'
  };

  function message(error, operation) {
    if (operation === 'clipboard') return fallbacks.clipboard;
    if (typeof error?.userMessage === 'string' && error.userMessage.trim()) return error.userMessage;
    const name = String(error?.name || '');
    const detail = String(error?.message || '');
    if (operation === 'pdf') {
      if (name === 'PasswordException' || /password.protected|password (?:required|incorrect)/i.test(detail)) {
        return 'This PDF is password-protected. Open it with the password in a PDF reader and save a copy without password protection, then select that copy and try Parse PDF again.';
      }
      if (name === 'MissingPDFException' || name === 'NotFoundError') {
        return 'The selected PDF is no longer available. Select the file again and try Parse PDF.';
      }
      if (name === 'AbortError') return 'Reading the PDF was interrupted. Select the file again and try Parse PDF.';
    }
    return fallbacks[operation] || 'This action could not be completed. Export a draft to keep your work, then refresh the app and try again.';
  }

  function label(value) {
    const labels = { 'xml-parse': 'XML syntax', error: 'Needs fixing', warning: 'Check before using', review: 'Review needed', high: 'Suggested repair', medium: 'Check first', low: 'Check carefully', manual: 'Needs your input' };
    const text = String(value || 'Review needed');
    return labels[text] || text.replace(/[-_]+/g, ' ').replace(/^./, first => first.toUpperCase());
  }

  return { error, message, label };
});
