/* Pointer-driven panel positions, independent of the transparent Electron host. */
window.CuePanelBehavior = class {
  constructor(getAppearance, savePositions) {
    this.getAppearance = getAppearance;
    this.savePositions = savePositions;
    this.frames = new Map([
      ['toolbar', document.getElementById('toolbar')],
      ['panel', document.getElementById('panel-wrap')],
      ['catalog', document.getElementById('catalog-scrim')],
      ['settings', document.getElementById('settings-scrim')],
      ['onboard', document.getElementById('onboard-scrim')]
    ]);
    this.offsets = {};
    document.querySelectorAll('[data-drag-panel]').forEach(handle => {
      handle.addEventListener('pointerdown', event => this.start(event, handle));
    });
    window.addEventListener('resize', () => this.refresh());
    window.addEventListener('blur', () => this.finish?.(false));
    this.resizeObserver = new ResizeObserver(() => { if (!this.finish) this.refresh(); });
    this.frames.forEach(frame => this.resizeObserver.observe(frame));
    this.resizeObserver.observe(document.getElementById('onboard'));
  }

  visible(key, frame) {
    return !frame.classList.contains('hidden') && (key !== 'panel' || !document.getElementById('panel').classList.contains('collapsed'));
  }

  place(key, requested) {
    const frame = this.frames.get(key);
    const x = Number.isFinite(requested?.x) ? requested.x : 0;
    const y = Number.isFinite(requested?.y) ? requested.y : 0;
    frame.style.translate = `${x}px ${y}px`;
    if (!this.visible(key, frame)) { this.offsets[key] = { x, y }; return; }
    const rect = (key === 'onboard' ? document.getElementById('onboard') : frame).getBoundingClientRect();
    // Visibility transitions must not change the stored drag position.
    const motion = key === 'panel' ? 0 : new DOMMatrixReadOnly(getComputedStyle(frame).transform).m42;
    const gutter = 40;
    const dx = Math.max(gutter - rect.left, Math.min(0, innerWidth - gutter - rect.right));
    const dy = Math.max(gutter - (rect.top - motion), Math.min(0, innerHeight - gutter - (rect.bottom - motion)));
    this.offsets[key] = { x: Math.round(x + dx), y: Math.round(y + dy) };
    frame.style.translate = `${this.offsets[key].x}px ${this.offsets[key].y}px`;
  }

  refresh() {
    const appearance = this.getAppearance() || {};
    document.documentElement.dataset.panelDrag = appearance.windowDrag === false ? 'off' : 'on';
    if (appearance.windowDrag === false) this.finish?.(false);
    if (this.finish) return;
    this.frames.forEach((frame, key) => this.place(key, appearance.panelPositions?.[key]));
  }

  start(event, handle) {
    if (event.button !== 0 || this.getAppearance()?.windowDrag === false || this.finish) return;
    if (event.target.closest('button, input, textarea, select, a, [role="separator"]')) return;
    const key = handle.dataset.dragPanel;
    const frame = this.frames.get(key);
    const original = { ...this.offsets[key] };
    const startX = event.clientX, startY = event.clientY;
    let moved = false;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('dragging-surfaces');
    window.cue.setIgnoreMouse(false);
    event.preventDefault();
    const move = next => {
      if (next.pointerId !== event.pointerId) return;
      const dx = next.clientX - startX, dy = next.clientY - startY;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      this.place(key, { x: (original.x || 0) + dx, y: (original.y || 0) + dy });
    };
    const up = next => { if (next.pointerId === event.pointerId) this.finish?.(true); };
    const cancel = () => this.finish?.(false);
    this.finish = commit => {
      this.finish = null;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      document.body.classList.remove('dragging-surfaces');
      if (commit && moved) this.savePositions({ ...this.getAppearance()?.panelPositions, [key]: this.offsets[key] });
      else this.place(key, original);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel);
  }
};
