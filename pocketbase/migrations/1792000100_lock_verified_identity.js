migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = 'id = @request.auth.id && @request.body.verified:changed = false && @request.body.email:changed = false';
  app.save(users);
}, () => {});
