const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow } = require('electron');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const value = await check(); if (value) return value; await wait(40); }
  throw new Error('Timed out: ' + label);
}
async function surface(key) {
  return until(async () => {
    const win = BrowserWindow.getAllWindows().find(w => w.cueSurface === key);
    if (!win || win.webContents.isLoading()) return false;
    return await win.webContents.executeJavaScript('document.documentElement.dataset.ready === "true"') ? win : false;
  }, key + ' ready');
}
const js = (win, code) => win.webContents.executeJavaScript(code);
async function screenshot(win, name) {
  win.moveTop();
  await js(win, 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  // Windows transparent surfaces can return the previous compositor frame once.
  await win.webContents.capturePage();
  await wait(150);
  const folder = path.resolve('.local-stt/qa/workspace'); fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, name + '.png');
  fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
  return file;
}
module.exports = { wait, until, surface, js, screenshot };
