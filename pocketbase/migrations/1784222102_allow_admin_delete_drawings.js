/// <reference path="../pb_data/types.d.ts" />

const adminEmail = "raulzarza.dev@gmail.com";
const isAdminRule = `@request.auth.email = "${adminEmail}"`;

migrate((app) => {
  const drawings = app.findCollectionByNameOrId("drawings");

  drawings.deleteRule = `owner = @request.auth.id || ${isAdminRule}`;

  app.save(drawings);
}, (app) => {
  const drawings = app.findCollectionByNameOrId("drawings");

  drawings.deleteRule = "owner = @request.auth.id";

  app.save(drawings);
});
