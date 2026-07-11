(function initAuroraPageRange(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AuroraPageRange = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function buildAuroraPageRange() {
  function parsePageRange(value) {
    const text = String(value || '').trim();
    if (!text) return [];
    const ranges = [];
    for (const rawPart of text.split(',')) {
      const part = rawPart.trim();
      const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!match) throw new Error(`Invalid page range: ${value}`);
      const start = Number(match[1]);
      const end = Number(match[2] || match[1]);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
        throw new Error(`Invalid page range: ${value}`);
      }
      ranges.push({ start, end });
    }
    return ranges;
  }

  function formatPageRange(ranges) {
    return (ranges || [])
      .map(range => range.start === range.end ? String(range.start) : `${range.start}-${range.end}`)
      .join(',');
  }

  function selectPageNumbers(totalPageCount, ranges) {
    if (!ranges.length) return Array.from({ length: totalPageCount }, (_, index) => index + 1);
    const selected = [];
    for (let page = 1; page <= totalPageCount; page++) {
      if (ranges.some(range => page >= range.start && page <= range.end)) selected.push(page);
    }
    if (!selected.length) {
      throw new Error(`Page range ${formatPageRange(ranges)} selected no pages from a ${totalPageCount}-page source.`);
    }
    return selected;
  }

  function selectPageObjects(pages, rangeText, totalPageCount = (pages || []).length) {
    const ranges = parsePageRange(rangeText);
    if (!ranges.length) return pages || [];
    const selected = new Set(selectPageNumbers(totalPageCount, ranges));
    return (pages || []).filter((page, index) => selected.has(Number(page?.page || index + 1)));
  }

  function continuationPageNumbers(totalPageCount, selectedPages) {
    const selected = new Set(selectedPages || []);
    return (selectedPages || [])
      .map(page => page + 1)
      .filter(page => page <= totalPageCount && !selected.has(page));
  }

  return {
    parsePageRange,
    formatPageRange,
    selectPageNumbers,
    selectPageObjects,
    continuationPageNumbers
  };
}));
