/* The main process moves native windows using screen DIP cursor coordinates. */
window.CuePanelBehavior = class {
  constructor(getAppearance) {
    this.getAppearance = getAppearance;
    const cue = window.cue;
    document.querySelectorAll(`[data-drag-panel="${cue.surface}"]`).forEach(handle => {
      handle.title = 'Перетащить панель · Shift: переместить все открытые панели';
      handle.addEventListener('pointerdown', event => this.start(event, handle));
    });
    document.querySelectorAll('.panel-resizer').forEach(handle => {
      handle.addEventListener('pointerdown', event => this.start(event, handle,
        handle.dataset.resizeEdge || handle.dataset.resizePanel));
    });
    window.addEventListener('blur', () => this.finish?.(true));
    window.addEventListener('beforeunload', () => this.finish?.(true));
    window.addEventListener('keydown', event => { if (event.key === 'Escape') this.finish?.(false); });
  }
  refresh() {
    document.documentElement.dataset.panelDrag = this.getAppearance()?.windowDrag === false ? 'off' : 'on';
    if (this.getAppearance()?.windowDrag === false) this.finish?.(false);
  }
  start(event, handle, edge) {
    if (event.button !== 0 || this.finish || (!edge && this.getAppearance()?.windowDrag === false)) return;
    if (!edge && event.target.closest('button, input, textarea, select, a, [role="separator"]')) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const bodyClass = edge ? 'resizing-panels' : 'dragging-surfaces';
    document.body.classList.add(bodyClass);
    document.body.dataset.resizeAxis = ['left', 'right'].includes(edge) ? 'x' : 'y';
    window.cue.setIgnoreMouse(false);
    window.cue.gestureStart({ edge, group: event.shiftKey });
    const end = e => { if (e.pointerId === event.pointerId) this.finish?.(true); };
    const cancel = () => this.finish?.(false);
    this.finish = commit => {
      this.finish = null;
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', end);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      document.body.classList.remove(bodyClass);
      delete document.body.dataset.resizeAxis;
      window.cue.gestureEnd(commit);
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', end);
  }
};
