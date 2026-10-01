import { useRef, useState, type CSSProperties, type ReactNode } from "react";

const key = "gws-timeline-panel-height";
const bounded = (height: number) => Math.round(Math.max(190, Math.min(window.innerHeight - 300, height)));

export function ResizableTimelinePanel({ children, onResizeStart }: { children: ReactNode; onResizeStart: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; height: number; value: number } | null>(null);
  const [height, setHeight] = useState(() => {
    try { return bounded(Number(localStorage.getItem(key)) || 320); } catch { return bounded(320); }
  });
  const save = (value: number) => {
    const next = bounded(value);
    setHeight(next);
    panel.current?.style.setProperty("--timeline-panel-height", `${next}px`);
    try { localStorage.setItem(key, String(next)); } catch { /* Session resizing remains available. */ }
  };
  return <div ref={panel} className="resizable-timeline-panel" style={{ "--timeline-panel-height": `${height}px` } as CSSProperties}>
    <div className="timeline-panel-resize" role="separator" tabIndex={0} aria-label="Высота таймлайна" aria-orientation="horizontal"
      aria-valuemin={190} aria-valuemax={Math.max(190, window.innerHeight - 300)} aria-valuenow={height}
      title="Потяните границу, чтобы увеличить таймлайн. Двойной щелчок — исходный размер."
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); onResizeStart();
        const current = panel.current!.getBoundingClientRect().height;
        drag.current = { y: event.clientY, height: current, value: current };
      }} onPointerMove={event => {
        if (!drag.current) return;
        drag.current.value = bounded(drag.current.height + drag.current.y - event.clientY);
        panel.current?.style.setProperty("--timeline-panel-height", `${drag.current.value}px`);
      }} onPointerUp={() => { if (drag.current) save(drag.current.value); drag.current = null; }}
      onLostPointerCapture={() => { if (drag.current) save(drag.current.value); drag.current = null; }}
      onDoubleClick={() => save(320)} onKeyDown={event => {
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault(); onResizeStart(); save(height + (event.key === "ArrowUp" ? 40 : -40));
      }}><span /></div>
    {children}
  </div>;
}
