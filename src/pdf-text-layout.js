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
    return (items || []).map(item => ({
      x: Number(item?.transform?.[4]) || 0,
      y: Math.round((Number(item?.transform?.[5]) || 0) * 2) / 2,
      str: String(item?.str || '')
    }));
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
        items: items.map(item => ({ x: item.x, y: item.y, str: item.str }))
      };
    }).filter(row => row.text);
  }

  function findColumnSplit(items) {
    const nonblank = items.filter(item => item.str.trim());
    if (nonblank.length < MINIMUM_ITEMS_FOR_COLUMNS) return null;

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

  function textItemsToLayout(rawItems) {
    const items = positionedItems(rawItems);
    const rows = groupRows(items);
    const split = findColumnSplit(items);
    const columns = split
      ? [
        { side: 'left', rows: rowsToRecords(rows, item => item.x < split.splitX) },
        { side: 'right', rows: rowsToRecords(rows, item => item.x >= split.splitX) }
      ]
      : [{ side: 'page', rows: rowsToRecords(rows) }];
    return {
      split,
      columns,
      lines: columns.flatMap(column => column.rows.map(row => row.text))
    };
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
    textItemsToLines
  };
});
