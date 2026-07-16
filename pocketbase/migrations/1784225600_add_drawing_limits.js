/// <reference path="../pb_data/types.d.ts" />

const adminEmail = "raulzarza.dev@gmail.com";
const isAdminRule = `@request.auth.email = "${adminEmail}"`;
const defaultLimitKey = "defaultRegisteredDrawingLimit";

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");

  const settings = new Collection({
    type: "base",
    name: "draw_settings",
    fields: [
      {
        name: "key",
        type: "text",
        required: true,
        max: 120,
      },
      {
        name: "value",
        type: "number",
        required: true,
        min: 1,
        max: 999,
      },
    ],
  });

  settings.listRule = `@request.auth.id != ""`;
  settings.viewRule = `@request.auth.id != ""`;
  settings.createRule = isAdminRule;
  settings.updateRule = isAdminRule;
  settings.deleteRule = isAdminRule;

  app.save(settings);

  const defaultLimit = new Record(settings);
  defaultLimit.set("key", defaultLimitKey);
  defaultLimit.set("value", 3);
  app.save(defaultLimit);

  const drawingLimits = new Collection({
    type: "base",
    name: "drawing_limits",
    fields: [
      {
        name: "owner",
        type: "relation",
        required: true,
        collectionId: users.id,
        cascadeDelete: true,
        maxSelect: 1,
      },
      {
        name: "maxDrawings",
        type: "number",
        required: true,
        min: 1,
        max: 999,
      },
    ],
  });

  drawingLimits.listRule = `owner = @request.auth.id || ${isAdminRule}`;
  drawingLimits.viewRule = `owner = @request.auth.id || ${isAdminRule}`;
  drawingLimits.createRule = isAdminRule;
  drawingLimits.updateRule = isAdminRule;
  drawingLimits.deleteRule = isAdminRule;

  app.save(drawingLimits);
}, (app) => {
  const drawingLimits = app.findCollectionByNameOrId("drawing_limits");
  const settings = app.findCollectionByNameOrId("draw_settings");

  app.delete(drawingLimits);
  app.delete(settings);
});
