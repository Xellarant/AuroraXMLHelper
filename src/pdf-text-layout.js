(function attachAuroraPdfTextLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.AuroraPdfTextLayout = api;
    if (root.window && root.window !== root) root.window.AuroraPdfTextLayout = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAuroraPdfTextLayout() {
  const ROW_TOLERANCE = 2;
  const MINIMUM_COLUMN_GAP = 18;
  const OUTER_MARGIN = 20;
  const MINIMUM_ITEMS_FOR_COLUMNS = 40;
  const MINIMUM_COLUMN_SHARE = 0.25;

  function positionedItems(items) {
    const positions = new Map();
    for (const item of (items || []).map(item => ({
      x: Number(item?.transform?.[4]) || 0,
      y: Math.round((Number(item?.transform?.[5]) || 0) * 2) / 2,
      str: String(item?.str || ''),
      width: Number(item?.width) || 0,
      height: Number(item?.height) || Math.abs(Number(item?.transform?.[3])) || 0,
      fontName: item?.fontName || ''
    }))) {
      if (!item.str.trim()) continue;
      const key = `${Math.round(item.x * 2)},${item.y}`;
      const existing = positions.get(key) || [];
      // Some PDFs paint the same label twice, or overprint a short bold prefix.
      if (existing.some(previous => previous.str.startsWith(item.str))) continue;
      positions.set(key, [...existing.filter(previous => !item.str.startsWith(previous.str)), item]);
    }
    return [...positions.values()].flat();
  }

  function groupRows(items) {
    const rows = [];
    for (const item of items) {
      let row = rows.find(candidate => Math.abs(candidate.y - item.y) < ROW_TOLERANCE);
      if (!row) {
        row = { y: item.y, items: [] };
        rows.push(row);
      }
      row.items.push(item);
    }
    return rows.sort((a, b) => b.y - a.y);
  }

  function rowText(items) {
    return items
      .slice()
      .sort((a, b) => a.x - b.x)
      .map(item => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rowsToLines(rows, filter) {
    return rowsToRecords(rows, filter).map(row => row.text);
  }

  function rowsToRecords(rows, filter) {
    return rows.map(row => {
      const items = filter ? row.items.filter(filter) : row.items;
      return {
        y: row.y,
        text: rowText(items),
        items: items.map(item => ({ ...item }))
      };
    }).filter(row => row.text);
  }

  function findColumnSplit(items) {
    const nonblank = items.filter(item => item.str.trim());
    const hasWidths = nonblank.some(item => item.width > 0);
    if (nonblank.length < (hasWidths ? 12 : MINIMUM_ITEMS_FOR_COLUMNS)) return null;
    if (hasWidths) return findWidthColumnSplit(nonblank);
    const xPositions = [...new Set(nonblank.map(item => Math.round(item.x)))].sort((a, b) => a - b);
    if (xPositions.length < 2) return null;

    const minX = xPositions[0];
    const maxX = xPositions[xPositions.length - 1];
    let bestGap = null;
    for (let index = 0; index < xPositions.length - 1; index++) {
      const left = xPositions[index];
      const right = xPositions[index + 1];
      const gap = right - left;
      if (gap < MINIMUM_COLUMN_GAP) continue;
      if (left <= minX + OUTER_MARGIN || right >= maxX - OUTER_MARGIN) continue;
      if (!bestGap || gap > bestGap.gap) bestGap = { left, right, gap };
    }
    if (!bestGap) return null;

    const splitX = (bestGap.left + bestGap.right) / 2;
    const leftCount = nonblank.filter(item => item.x < splitX).length;
    const rightCount = nonblank.length - leftCount;
    const minimumSideCount = nonblank.length * MINIMUM_COLUMN_SHARE;
    if (leftCount < minimumSideCount || rightCount < minimumSideCount) return null;

    return { splitX, gap: bestGap.gap, leftCount, rightCount, itemCount: nonblank.length };
  }

  function findWidthColumnSplit(items) {
    const minX = Math.min(...items.map(item => item.x));
    const maxX = Math.max(...items.map(item => item.x + item.width));
    const span = maxX - minX;
    const step = Math.max(1, span / 600);
    const heights = items.map(item => item.height).filter(Boolean).sort((a, b) => a - b);
    const bodyHeight = heights[Math.floor(heights.length / 2)] || 0;
    const ink = items.filter(item => !item.height || (item.height >= bodyHeight * 0.75 && item.height <= bodyHeight * 1.4));
    const minimumSide = Math.max(4, items.length * 0.06);
    const maximumCrossings = Math.max(1, ink.length * 0.02);
    let start = null;
    let best = null;
    // Look for a sustained low-ink gutter, rather than a gap in text starts.
    // This tolerates a few centered heading/caption glyphs and fragmented OCR.
    for (let x = minX + span * 0.3; x <= minX + span * 0.7; x += step) {
      const left = items.filter(item => item.x < x);
      const crossings = ink.filter(item => item.x < x && item.x + item.width > x + 2).length;
      const valid = crossings <= maximumCrossings && left.length >= minimumSide && items.length - left.length >= minimumSide;
      if (valid && start === null) start = x;
      if ((!valid || x + step > minX + span * 0.7) && start !== null) {
        const end = valid ? x : x - step;
        if (end - start >= 12 && (!best || end - start > best.gap)) best = { splitX: (start + end) / 2, gap: end - start };
        start = null;
      }
    }
    if (!best) return null;
    const leftCount = items.filter(item => item.x < best.splitX).length;
    return { ...best, leftCount, rightCount: items.length - leftCount, itemCount: items.length };
  }

  function referenceBlocks(items, styles) {
    const fonts = new Map();
    for (const item of items.filter(item => item.str.trim())) {
      if (!fonts.has(item.fontName)) fonts.set(item.fontName, []);
      fonts.get(item.fontName).push(item);
    }
    const byVolume = [...fonts.entries()].sort((a, b) => b[1].reduce((n, i) => n + i.str.length, 0)
      - a[1].reduce((n, i) => n + i.str.length, 0));
    const dominant = byVolume[0];
    if (!dominant) return [];
    const blocks = [];
    for (const [font, group] of byVolume.slice(1)) {
      const style = styles[font] || {};
      const handwritten = /DearSarah|Handwrit|Cursive|Caveat|DancingScript/i.test(style.name || '');
      const prose = group.filter(item => item.str.trim().length > 12);
      const insetProse = prose.filter(item => item.x > Math.min(...items.map(i => i.x)) + 150);
      // An inset prose block in a contrasting family is reference material,
      // not a reason to discard every use of that font (tables and labels use it too).
      const inset = styles[dominant[0]]?.fontFamily === 'serif' && style.fontFamily === 'sans-serif'
        && insetProse.length >= 4 && Math.max(...insetProse.map(i => i.x)) - Math.min(...insetProse.map(i => i.x)) < 6;
      if (!handwritten && !inset) continue;
      if (handwritten) {
        blocks.push({ kind: 'annotation', items: group });
      } else {
        const x = Math.min(...insetProse.map(i => i.x));
        const insetItems = group.filter(i => Math.abs(i.x - x) < 6);
        const top = Math.max(...insetItems.map(i => i.y + i.height));
        const bottom = Math.min(...insetItems.map(i => i.y));
        const right = Math.max(...insetItems.map(i => i.x + i.width));
        blocks.push({ kind: 'reference', items: items.filter(i => i.x >= x - 2 && i.x < right
          && i.y >= bottom - 2 && i.y <= top + 18) });
      }
    }
    return blocks.map(block => ({ ...block, lines: rowsToLines(groupRows(block.items)) }));
  }

  function progressionTables(items) {
    const rows = groupRows(items);
    const tables = [];
    for (let index = 0; index < rows.length; index++) {
      const anchors = rows[index].items.filter(item => /^(?:Level|Bonus|Features|Known|[1-9](?:st|nd|rd|th))$/i.test(item.str.trim()))
        .map(item => ({ ...item, str: item.str.trim() })).sort((a, b) => a.x - b.x);
      if (!anchors.some(i => /^Level$/i.test(i.str)) || !anchors.some(i => /^Features$/i.test(i.str))) continue;
      const first = rows[index + 1];
      if (!first || !/^\d+(?:st|nd|rd|th)\s+\+\d\b/.test(rowText(first.items))) continue;
      const previous = rows[index - 1];
      const labels = anchors.map((anchor, column) => {
        const left = column ? (anchors[column - 1].x + anchor.x) / 2 : -Infinity;
        const right = column + 1 < anchors.length ? (anchor.x + anchors[column + 1].x) / 2 : Infinity;
        const above = previous && previous.y - rows[index].y < 18
          ? rowText(previous.items.filter(item => item.x >= left && item.x < right)) : '';
        return /^(?:Known|Bonus)$/i.test(anchor.str) ? `${above} ${anchor.str}`.trim() : anchor.str;
      });
      if (!labels.some(label => /^(?:[1-9](?:st|nd|rd|th))$/.test(label))) continue;
      let end = index + 1;
      const data = [];
      while (end < rows.length && /^\d+(?:st|nd|rd|th)\s+\+\d\b/.test(rowText(rows[end].items))) {
        data.push(anchors.map((anchor, column) => {
          const left = column ? (anchors[column - 1].x + anchor.x) / 2 : -Infinity;
          const right = column + 1 < anchors.length ? (anchor.x + anchors[column + 1].x) / 2 : Infinity;
          return rowText(rows[end].items.filter(item => item.x >= left && item.x < right));
        }));
        end++;
      }
      if (data.length < 2) continue;
      const title = rows.slice(Math.max(0, index - 4), index).reverse()
        .find(row => rows[index].y - row.y > -40 && /^The [A-Za-z' -]+$/.test(rowText(row.items)));
      const top = title?.y || (previous && previous.y - rows[index].y < 18 ? previous.y : rows[index].y);
      const bottom = rows[end - 1].y;
      const lines = [rowText(title?.items || []), `| ${labels.join(' | ')} |`,
        `| ${labels.map(() => '---').join(' | ')} |`, ...data.map(cells => `| ${cells.join(' | ')} |`)].filter(Boolean);
      tables.push({ top, bottom, headers: labels, rows: data, lines });
      index = end - 1;
    }
    return tables;
  }

  function textItemsToLayout(rawItems, options = {}) {
    const original = positionedItems(rawItems);
    const references = referenceBlocks(original, options.styles || {});
    const excluded = new Set(references.flatMap(block => block.items));
    const items = original.filter(item => !excluded.has(item));
    const tables = progressionTables(items);
    const columns = [];
    let split = null;
    function addBand(band) {
      if (!band.length) return;
      const rows = groupRows(band);
      const bandSplit = findColumnSplit(band);
      if (bandSplit) {
        split ||= bandSplit;
        columns.push({ side: 'left', rows: rowsToRecords(rows, item => item.x < bandSplit.splitX) },
          { side: 'right', rows: rowsToRecords(rows, item => item.x >= bandSplit.splitX) });
      } else columns.push({ side: 'page', rows: rowsToRecords(rows) });
    }
    let ceiling = Infinity;
    for (const table of tables) {
      addBand(items.filter(item => item.y < ceiling && item.y > table.top));
      columns.push({ side: 'table', rows: table.lines.map(text => ({ text, y: table.top, items: [] })) });
      ceiling = table.bottom;
    }
    addBand(items.filter(item => item.y < ceiling));
    const mainLines = columns.flatMap(column => column.rows.map(row => row.text));
    // Keep inset reference prose readable for other element types. Class parsing
    // uses mainLines and places these references in the class overview instead.
    for (const block of references.filter(block => block.kind === 'reference')) {
      columns.push({ side: 'reference', rows: rowsToRecords(groupRows(block.items)) });
    }
    return {
      split,
      columns,
      tables,
      references,
      mainLines,
      lines: columns.flatMap(column => column.rows.map(row => row.text))
    };
  }

  async function extractPageLayout(page) {
    const content = await page.getTextContent();
    const styles = { ...content.styles };
    // PDF.js exposes original font names only after loading the operator list.
    // Resolve them only for unusually tall script metrics, not on every page.
    if (Object.values(styles).some(style => style.ascent > 1.3 && style.descent < -0.8)) {
      await page.getOperatorList();
      for (const [key, style] of Object.entries(styles)) {
        if (page.commonObjs.has(key)) styles[key] = { ...style, name: page.commonObjs.get(key).name };
      }
    }
    return textItemsToLayout(content.items, { styles });
  }

  function textItemsToLines(rawItems) {
    return textItemsToLayout(rawItems).lines;
  }

  return {
    ROW_TOLERANCE,
    MINIMUM_COLUMN_GAP,
    OUTER_MARGIN,
    MINIMUM_ITEMS_FOR_COLUMNS,
    MINIMUM_COLUMN_SHARE,
    groupRows,
    findColumnSplit,
    textItemsToLayout,
    extractPageLayout,
    textItemsToLines
  };
});
