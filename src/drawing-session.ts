type Draft = { id: string; owner: string; created: string; scene: { elements?: unknown[] } };

export const hasDraftContent = (draft: Pick<Draft, "scene">) =>
  (draft.scene.elements || []).some(element =>
    !!element && typeof element === "object" && !(element as { isDeleted?: boolean }).isDeleted,
  );

export const selectDrawingId = (current: string | null, drawings: { id: string }[]) =>
  drawings.some(drawing => drawing.id === current) ? current : drawings[0]?.id ?? null;

// Publish saved drawings independently of optional quota configuration.
export async function loadAccountLibrary<T>({ loadDrawings, loadLimit, publish, isCurrent }: {
  loadDrawings: () => Promise<T[]>;
  loadLimit: () => Promise<number>;
  publish: (drawings: T[]) => void;
  isCurrent: () => boolean;
}) {
  const limitResult = loadLimit().then(value => value, () => null);
  const drawings = await loadDrawings();
  if (!isCurrent()) return null;
  publish(drawings);
  const limit = await limitResult;
  return isCurrent() ? { drawings, limit } : null;
}

// Stable server IDs make retries safe even if a create response was lost.
export async function draftImportId(owner: string, created: string) {
  const data = new TextEncoder().encode(JSON.stringify(["draw-local-import-v1", owner, created]));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 15);
}

export function createDraftImporter<T extends Draft>() {
  const pending = new Map<string, Promise<T>>();
  return async (draft: T, owner: string, io: {
    create: (id: string) => Promise<T>;
    find: (id: string) => Promise<T>;
    isCurrent: () => boolean;
  }) => {
    if (!hasDraftContent(draft)) return null;
    const id = await draftImportId(owner, draft.created);
    if (!io.isCurrent()) return null;
    let request = pending.get(id);
    if (!request) {
      request = (async () => {
        try {
          return await io.create(id);
        } catch (error) {
          if (!io.isCurrent()) throw error;
          // A previous attempt may already have committed this same draft.
          const existing = await io.find(id).catch(() => null);
          if (existing?.owner === owner) return existing;
          throw error;
        }
      })();
      pending.set(id, request);
    }
    try { return await request; }
    finally { if (pending.get(id) === request) pending.delete(id); }
  };
}
