// All geometry is in Electron screen DIP coordinates, including negative origins.
const SURFACES = ['panel', 'toolbar', 'settings', 'catalog', 'onboard'];
const PADDING = 24;

function normalizeLayout(value) {
  const windows = {};
  if (value?.version !== 2) return { version: 2, windows };
  for (const key of SURFACES) {
    const item = value.windows?.[key];
    if (!item || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(item[k]))) continue;
    windows[key] = {
      x: Math.round(Math.max(-100000, Math.min(100000, item.x))),
      y: Math.round(Math.max(-100000, Math.min(100000, item.y))),
      width: Math.round(Math.max(80, Math.min(4000, item.width))),
      height: Math.round(Math.max(60, Math.min(4000, item.height))),
      displayId: String(item.displayId ?? '')
    };
  }
  return { version: 2, windows };
}

function legacyLayout(appearance, primary) {
  const a = appearance;
  const w = primary.workArea;
  const hostWidth = Math.min(1600, w.width);
  const hostX = Math.round(w.x + (w.width - hostWidth) / 2);
  const panelWidth = a.panelWidth || 624;
  const settingsWidth = a.settingsWidth || 440;
  const catalogWidth = a.catalogWidth || 440;
  const legacySettingsWidth = Math.min(settingsWidth, Math.max(1, (hostWidth - panelWidth - 104) / 2));
  const positions = {
    toolbar: { x: w.x + (w.width - 140) / 2, y: w.y + 46, width: 140, height: 40 },
    panel: { x: w.x + (w.width - panelWidth) / 2, y: w.y + 98 + (a.panelOffsetY || 0), width: panelWidth, height: a.panelHeight || 540 },
    settings: { x: hostX + hostWidth - 40 - legacySettingsWidth, y: w.y + 6 + Math.max(40, a.settingsTop || 14), width: settingsWidth, height: a.settingsHeight || 690 },
    catalog: { x: hostX + 40, y: w.y + 6 + Math.max(40, a.catalogTop || 14), width: catalogWidth, height: a.catalogHeight || 690 },
    onboard: { x: hostX + 40, y: w.y + 46, width: settingsWidth, height: 560 }
  };
  return Object.fromEntries(SURFACES.map(key => {
    const r = positions[key], offset = a.panelPositions?.[key] || {};
    return [key, { x: Math.round(r.x + (offset.x || 0) - PADDING), y: Math.round(r.y + (offset.y || 0) - PADDING), width: r.width + PADDING * 2, height: r.height + PADDING * 2, displayId: String(primary.id) }];
  }));
}

function nearestDisplay(bounds, displays) {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + PADDING + 16 };
  return displays.reduce((best, d) => {
    const r = d.workArea;
    const distance = Math.hypot(Math.max(r.x - center.x, 0, center.x - r.x - r.width), Math.max(r.y - center.y, 0, center.y - r.y - r.height));
    return !best || distance < best.distance ? { display: d, distance } : best;
  }, null)?.display;
}

function reachableBounds(bounds, displays) {
  const d = nearestDisplay(bounds, displays);
  if (!d) return { ...bounds };
  const r = d.workArea;
  const width = Math.min(bounds.width, r.width + PADDING * 2);
  const height = Math.min(bounds.height, r.height + PADDING * 2);
  return {
    x: Math.round(Math.max(r.x - width + PADDING + 96, Math.min(bounds.x, r.x + r.width - PADDING - 96))),
    y: Math.round(Math.max(r.y - PADDING, Math.min(bounds.y, r.y + r.height - PADDING - 40))),
    width, height, displayId: String(d.id)
  };
}

function resizeBounds(start, edge, dx, dy, surface) {
  const minWidth = (surface === 'panel' ? 520 : 300) + 2 * PADDING;
  const minHeight = (surface === 'panel' ? 280 : 320) + 2 * PADDING;
  const maxWidth = (surface === 'panel' ? 1200 : 800) + 2 * PADDING;
  const maxHeight = 1600 + 2 * PADDING;
  const r = { ...start };
  if (edge === 'left' || edge === 'right') {
    r.width = Math.round(Math.max(minWidth, Math.min(maxWidth, start.width + (edge === 'left' ? -dx : dx))));
    if (edge === 'left') r.x = start.x + start.width - r.width;
  } else if (edge === 'top' || edge === 'bottom') {
    r.height = Math.round(Math.max(minHeight, Math.min(maxHeight, start.height + (edge === 'top' ? -dy : dy))));
    if (edge === 'top') r.y = start.y + start.height - r.height;
  }
  return r;
}

module.exports = { SURFACES, PADDING, normalizeLayout, legacyLayout, nearestDisplay, reachableBounds, resizeBounds };
