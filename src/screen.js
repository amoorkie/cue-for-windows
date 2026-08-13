// Full-resolution screenshot via desktopCapturer (main process).
// First call triggers the macOS Screen-Recording permission prompt for the app.
const { desktopCapturer, screen } = require('electron');

async function captureScreenshot(display = screen.getPrimaryDisplay()) {
  const { width, height } = display.size;
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.floor(width * scale), height: Math.floor(height * scale) }
  });
  if (!sources.length) return null;
  // Capture the display containing the overlay (the primary display is the fallback).
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  const img = src.thumbnail;
  if (!img || img.isEmpty()) return null;
  const size = img.getSize();
  const maxDimension = 1600;
  const resizeScale = Math.min(1, maxDimension / Math.max(size.width, size.height));
  const optimized = resizeScale < 1
    ? img.resize({ width: Math.max(1, Math.round(size.width * resizeScale)), height: Math.max(1, Math.round(size.height * resizeScale)) })
    : img;
  return 'data:image/jpeg;base64,' + optimized.toJPEG(82).toString('base64');
}

module.exports = { captureScreenshot };
