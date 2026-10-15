type Scene = {
  elements?: unknown[];
  files?: Record<string, unknown>;
  appState?: Record<string, unknown>;
};
export function mergeScenes<T extends Scene>(current: T, incoming: T): T;
export function sceneFingerprint(scene: Scene): string;
