// Real native windows + production IPC, deterministic DIP cursor positions.
// Physical pointer dragging, mixed-DPI handoff and disconnect remain device checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, screen, globalShortcut } = require('electron');
const { wait, until, surface, js } = require('./electron-helpers');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-windows-'));
app.setPath('userData', root);
process.env.CUE_DOCUMENTS_DIR = path.join(root, 'documents');
globalShortcut.register = () => true;
fs.writeFileSync(path.join(root, 'cue-data.json'), JSON.stringify({ onboarded:true }));
let cursor = { x:200, y:200 };
require('../main');
app.whenReady().then(async () => {
  try {
    screen.getCursorScreenPoint = () => cursor;
    const panel = await surface('panel'), toolbar = await surface('toolbar');
    await js(panel, `cue.windowOpen('settings')`);
    const settings = await surface('settings');
    const drag = async (win, dx, dy, options={}) => {
      await js(win, `cue.gestureStart(${JSON.stringify(options)})`); await wait(35);
      cursor = { x:cursor.x+dx, y:cursor.y+dy }; await wait(50);
      await js(win, 'cue.gestureEnd(true)'); await wait(50);
    };
    const initial = panel.getBounds(), other = settings.getBounds();
    await drag(panel, 80, 70);
    assert.equal(panel.getBounds().x, initial.x+80); assert.equal(panel.getBounds().y, initial.y+70);
    assert.deepEqual(settings.getBounds(), other, 'independent movement');
    const saved = (await js(panel, 'cue.settingsGet()')).windowLayout.windows.panel;
    assert.equal(saved.x, panel.getBounds().x);
    const moved = panel.getBounds();
    panel.webContents.reload(); await surface('panel');
    assert.deepEqual(panel.getBounds(), moved, 'renderer reload preserves native geometry');
    const beforeGroup = [panel, toolbar, settings].map(w=>w.getBounds());
    await drag(toolbar, 45, 30, {group:true});
    [panel, toolbar, settings].forEach((w,i)=>{
      assert.equal(w.getBounds().x,beforeGroup[i].x+45); assert.equal(w.getBounds().y,beforeGroup[i].y+30);
    });
    await js(panel, 'cue.settingsSet({appearance:{windowDrag:false}})');
    const frozen=panel.getBounds(); await drag(panel, 70, 60); assert.deepEqual(panel.getBounds(), frozen);
    await js(panel, 'cue.settingsSet({appearance:{windowDrag:true}})');
    const resize=panel.getBounds(); await drag(panel, 80, 0, {edge:'right'});
    assert.equal(panel.getBounds().width,resize.width+80);
    assert.equal(panel.getBounds().x,resize.x);
    const displays=screen.getAllDisplays();
    if(displays.length>1){
      const target=displays.find(d=>d.id!==screen.getPrimaryDisplay().id);
      const current=panel.getBounds();
      await drag(panel,target.workArea.x+60-current.x,target.workArea.y+60-current.y);
      assert.equal(screen.getDisplayMatching(panel.getBounds()).id,target.id,'native window reaches the other monitor');
      assert.equal((await js(panel,'cue.settingsGet()')).windowLayout.windows.panel.displayId,String(target.id));
    }
    const selected=(await js(panel,'cue.displaysGet()')).selectedId;
    const realDisplays=screen.getAllDisplays;
    const primary=screen.getPrimaryDisplay();
    screen.getAllDisplays=()=>[primary];
    screen.emit('display-removed',{},displays.at(-1)); await wait(60);
    assert.ok(panel.getBounds().x+panel.getBounds().width>=primary.workArea.x+96,'title remains reachable after display removal');
    assert.equal((await js(panel,'cue.displaysGet()')).selectedId,selected);
    screen.getAllDisplays=realDisplays;
    const resetSize = panel.getBounds();
    await js(panel,'cue.windowReset()'); await wait(50);
    assert.equal(screen.getDisplayMatching(panel.getBounds()).id,primary.id);
    assert.equal(panel.getBounds().width,resetSize.width,'reset position preserves resized width');
    assert.equal(panel.getBounds().height,resetSize.height,'reset position preserves resized height');
    await js(panel,'cue.settingsSet({appearance:{animations:false}})');
    await until(()=>js(panel,`document.documentElement.dataset.animations==='off'`),'animations disabled');
    await js(panel,'cue.settingsSet({appearance:{animations:true}})');
    panel.webContents.debugger.attach('1.3');
    await panel.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await until(()=>js(panel,`document.documentElement.dataset.animations==='off'`),'reduced motion');
    console.log(JSON.stringify({pass:true,checks:['native DIP movement','independent windows','group movement','persistence','disabled drag','native resize','display recovery','selected screen stable','reset','reduced motion'],nativeDisplays:displays.map(d=>({id:d.id,bounds:d.bounds,scaleFactor:d.scaleFactor}))}));
    app.emit('will-quit');app.exit(0);
  }catch(error){console.error(error.stack);app.emit('will-quit');app.exit(1);}
});
setTimeout(()=>{console.error('Window behavior timeout');app.exit(1);},30000).unref();
