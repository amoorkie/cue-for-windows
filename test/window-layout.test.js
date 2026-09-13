const { test } = require('node:test');
const assert = require('node:assert/strict');
const { legacyLayout, reachableBounds, resizeBounds, normalizeLayout } = require('../src/window-layout');
const displays = [
  { id: 1, workArea: { x: 0, y: 0, width: 2560, height: 1392 }, scaleFactor: 1 },
  { id: 2, workArea: { x: -1536, y: -100, width: 1536, height: 824 }, scaleFactor: 1.25 }
];
test('secondary display coordinates stay negative and are not scaled twice', () => {
  const r = { x: -1200, y: 0, width: 672, height: 588 };
  assert.deepEqual(reachableBounds(r, displays), { ...r, displayId: '2' });
});
test('unplugging a monitor makes the title bar reachable on the remaining display', () => {
  const r = reachableBounds({ x: -1400, y: -200, width: 672, height: 588 }, displays.slice(0, 1));
  assert.ok(r.x + r.width >= 120); assert.ok(r.y >= -24); assert.equal(r.displayId, '1');
});
test('migration retains independent legacy offsets and chosen panel dimensions', () => {
  const plain = legacyLayout({ panelWidth: 760, panelHeight: 884 }, displays[0]);
  const moved = legacyLayout({ panelWidth: 760, panelHeight: 884, panelPositions: { panel: { x: -380, y: 173 } } }, displays[0]);
  assert.equal(moved.panel.x, plain.panel.x - 380); assert.equal(moved.panel.y, plain.panel.y + 173);
  assert.equal(moved.panel.width, 808); assert.equal(moved.panel.height, 932);
  assert.deepEqual(moved.toolbar, plain.toolbar);
});
test('resizing from the left preserves the right edge at the minimum width', () => {
  const start = { x: -1200, y: 50, width: 808, height: 588 };
  const r = resizeBounds(start, 'left', 900, 0, 'panel');
  assert.equal(r.x + r.width, start.x + start.width); assert.equal(r.width, 568);
});
test('layout normalization rejects non-finite geometry and unknown surfaces', () => {
  const result = normalizeLayout({ version: 2, windows: { panel: { x: Infinity, y: 1, width: 2, height: 3 }, arbitrary: { x: 1, y: 1, width: 5, height: 6 } } });
  assert.deepEqual(result.windows, {});
});
