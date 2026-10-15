// Shared by PocketBase and the browser. Excalidraw resolves equal-version
// conflicts with the lowest versionNonce; deleted elements are tombstones.
function mergeScenes(current = {}, incoming = {}) {
  current = current || {};
  incoming = incoming || {};
  const elements = new Map();
  for (const element of [...(current.elements || []), ...(incoming.elements || [])]) {
    if (!element || typeof element.id !== "string") continue;
    const previous = elements.get(element.id);
    if (!previous || (element.version || 0) > (previous.version || 0) ||
      ((element.version || 0) === (previous.version || 0) &&
        (element.versionNonce || 0) < (previous.versionNonce || 0))) {
      elements.set(element.id, element);
    }
  }
  return {
    ...current, ...incoming,
    elements: [...elements.values()].sort((a, b) => {
      const left = a.index || a.id;
      const right = b.index || b.id;
      return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
    }),
    files: { ...(current.files || {}), ...(incoming.files || {}) },
  };
}

// Ignore view/selection changes and remote echoes when deciding to save.
function sceneFingerprint(scene = {}) {
  return JSON.stringify({
    elements: (scene.elements || []).map(e => [e.id, e.version, e.versionNonce, e.isDeleted, e.index]),
    files: Object.keys(scene.files || {}).sort(),
    background: scene.appState && scene.appState.viewBackgroundColor,
  });
}

module.exports = { mergeScenes, sceneFingerprint };
