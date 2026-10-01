import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const DEFAULT_HEIGHT = 340;
const HEIGHT_KEY = "gws-console-height";

export function ResizableConsolePanel({ open, children }: { open: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number; pointerId: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [height, setHeight] = useState(() => {
    try { const saved = Number(localStorage.getItem(HEIGHT_KEY)); return Number.isFinite(saved) && saved >= 150 ? saved : DEFAULT_HEIGHT; }
    catch { return DEFAULT_HEIGHT; }
  });
  const [maximum, setMaximum] = useState(Math.max(150, window.innerHeight - 180));
  const limits = () => {
    const parent = panel.current?.parentElement;
    // Leave the page and all status/production bars accessible above the console.
    const reserved = parent ? Array.from(parent.children).filter(el => el !== panel.current && !el.classList.contains("page-scroll"))
      .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0) : 108;
    const max = Math.max(150, (parent?.clientHeight ?? window.innerHeight) - reserved - 72);
    return { min: 150, max };
  };
  const resize = (value: number) => {
    const { min, max } = limits();
    setMaximum(max);
    setHeight(Math.round(Math.max(min, Math.min(max, value))));
  };
  useLayoutEffect(() => {
    // Also remeasure when a production/status bar is inserted by the parent.
    const { max } = limits();
    if (maximum !== max) setMaximum(max);
  });
  useEffect(() => {
    const onResize = () => setMaximum(limits().max);
    const onBlur = () => { drag.current = null; setResizing(false); };
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("blur", onBlur); };
  }, []);
  useEffect(() => { try { localStorage.setItem(HEIGHT_KEY, String(height)); } catch { /* Session resizing still works. */ } }, [height]);
  useEffect(() => {
    document.body.classList.toggle("console-is-resizing", resizing);
    return () => document.body.classList.remove("console-is-resizing");
  }, [resizing]);
  useEffect(() => { if (!open) { drag.current = null; setResizing(false); } }, [open]);
  const visibleHeight = Math.min(height, maximum);
  const stop = () => { drag.current = null; setResizing(false); };

  return <div ref={panel} id="console-log-panel" className={`console-dock${open ? " open" : ""}${resizing ? " resizing" : ""}`}
    style={open ? { height: visibleHeight } : undefined}>
    {open && <div className="console-resize-handle" role="separator" tabIndex={0} aria-orientation="horizontal"
      aria-label="Изменить высоту консоли" aria-controls="console-log-panel"
      aria-valuemin={150} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(visibleHeight)}
      title="Потяните вверх или вниз. Двойной щелчок — исходная высота. Стрелки ↑/↓ — изменить высоту."
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { y: event.clientY, height: panel.current!.getBoundingClientRect().height, pointerId: event.pointerId };
        setResizing(true);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start && start.pointerId === event.pointerId) resize(start.height + start.y - event.clientY);
      }}
      onPointerUp={event => { stop(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={stop} onLostPointerCapture={stop}
      onDoubleClick={() => resize(DEFAULT_HEIGHT)}
      onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const { min, max } = limits();
        resize(event.key === "Home" ? min : event.key === "End" ? max : visibleHeight + (event.key === "ArrowUp" ? 40 : -40));
      }}><span /></div>}
    {children}
  </div>;
}
