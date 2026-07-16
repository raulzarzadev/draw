/// <reference path="../pb_data/types.d.ts" />

const adminEmail = "raulzarza.dev@gmail.com";
const isAdminRule = `@request.auth.email = "${adminEmail}"`;

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  const drawings = app.findCollectionByNameOrId("drawings");

  users.listRule = isAdminRule;
  users.viewRule = `id = @request.auth.id || ${isAdminRule}`;

  drawings.listRule = `owner = @request.auth.id || ${isAdminRule}`;
  drawings.viewRule = `owner = @request.auth.id || ${isAdminRule}`;

  app.save(users);
  app.save(drawings);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const drawings = app.findCollectionByNameOrId("drawings");

  users.listRule = null;
  users.viewRule = "id = @request.auth.id";

  drawings.listRule = "owner = @request.auth.id";
  drawings.viewRule = "owner = @request.auth.id";

  app.save(users);
  app.save(drawings);
});
