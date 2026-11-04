export type LaserPosition = { sessionId: string; x: number; y: number; active: boolean };
export type LaserPointerUpdate = { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" };

// Coalesce motion, never the start/end transitions that create a remote trail.
export function createLaserSender({ sessionId, send, onError, interval = 80 }: {
  sessionId: string;
  send: (position: LaserPosition) => Promise<unknown>;
  onError?: () => void;
  interval?: number;
}) {
  const queue: LaserPosition[] = [];
  let wasActive = false;
  let sending = false;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    timer = undefined;
    if (sending || disposed || !queue.length) return;
    const position = queue.shift()!;
    sending = true;
    try { await send(position); }
    catch { if (!disposed) onError?.(); }
    finally {
      sending = false;
      if (!disposed) timer = setTimeout(() => void flush(), interval);
    }
  };
  return {
    update(event: LaserPointerUpdate) {
      if (disposed) return;
      const active = event.pointer.tool === "laser" && event.button === "down";
      if (!active && !wasActive) return;
      const continued = active && wasActive;
      wasActive = active;
      const position = { sessionId, x: event.pointer.x, y: event.pointer.y, active };
      const last = queue[queue.length - 1];
      // Keep the first queued down even when a new stroke starts during a send.
      if (continued && last?.active && queue.length > 1 && queue[queue.length - 2].active) {
        queue[queue.length - 1] = position;
      } else {
        queue.push(position);
      }
      // The first down is sent immediately, before pointerup can overwrite it.
      if (!timer && !sending) void flush();
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      if (timer) clearTimeout(timer);
    },
  };
}
