onRecordUpdateRequest((e) => {
  const info = e.requestInfo();
  if (info.query.scene_merge !== "1" || !info.body.scene) return e.next();
  const { mergeScenes } = require(__hooks + "/lib/scene.cjs");
  const incoming = JSON.parse(e.record.getString("scene") || "{}");
  const originalApp = e.app;
  originalApp.runInTransaction((txApp) => {
    const latest = txApp.findRecordById("drawings", e.record.id);
    // Recheck permissions inside the transaction, including a revoked link.
    if (!e.hasSuperuserAuth() && !txApp.canAccessRecord(latest, info, latest.collection().updateRule)) {
      throw new ForbiddenError("This drawing is no longer editable");
    }
    const current = JSON.parse(latest.getString("scene") || "{}");
    e.record.set("scene", JSON.stringify(mergeScenes(current, incoming)));
    // Avoid overwriting metadata changed by another request since this record
    // was loaded. Keep only fields explicitly submitted in this request.
    for (const field of ["title", "share_mode", "share_token", "owner"]) {
      if (!(field in info.body)) e.record.set(field, latest.get(field));
    }
    e.app = txApp;
    try { e.next(); } finally { e.app = originalApp; }
  });
}, "drawings");

// Laser positions are ephemeral SSE messages, never database records. Custom
// topics are not automatically protected by PocketBase's collection rules.
routerAdd("POST", "/api/drawings/{id}/laser", (e) => {
  const drawing = e.app.findRecordById("drawings", e.request.pathValue("id"));
  const info = e.requestInfo();
  // Only an owner/editor can present; viewers can receive the laser.
  if (!e.app.canAccessRecord(drawing, info, drawing.collection().updateRule)) {
    throw new ForbiddenError("This drawing is not editable");
  }
  const body = info.body;
  if (typeof body.sessionId !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(body.sessionId) ||
      typeof body.x !== "number" || typeof body.y !== "number" ||
      !Number.isFinite(body.x) || !Number.isFinite(body.y) ||
      Math.abs(body.x) > 1e7 || Math.abs(body.y) > 1e7) {
    throw new BadRequestError("Invalid laser position");
  }
  const topic = "draw-laser/" + drawing.id;
  const payload = JSON.stringify({
    sessionId: body.sessionId,
    pointer: { x: body.x, y: body.y, tool: "laser" },
    button: body.active === true ? "down" : "up",
  });
  const clients = e.app.subscriptionsBroker().clients();
  for (const id in clients) {
    const client = clients[id];
    const subscriptions = client.subscriptions(topic);
    for (const subscription in subscriptions) {
      if (subscription.split("?")[0] !== topic) continue;
      const options = subscriptions[subscription];
      const subscriberInfo = new RequestInfo({
        auth: client.get("auth"), method: "GET", body: {},
        query: options.query || {}, headers: options.headers || {},
      });
      if (!e.app.canAccessRecord(drawing, subscriberInfo, drawing.collection().viewRule)) continue;
      client.send(new SubscriptionMessage({ name: subscription, data: payload }));
    }
  }
  return e.json(200, { sent: true });
});
