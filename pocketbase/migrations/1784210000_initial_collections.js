migrate((app) => {
  let users;
  try {
    users = app.findCollectionByNameOrId("users");
  } catch {
    users = new Collection({ type: "auth", name: "users" });
    app.save(users);
  }
  try {
    app.findCollectionByNameOrId("drawings");
    return;
  } catch {}
  const own = '@request.auth.id != "" && owner = @request.auth.id';
  app.save(new Collection({
    type: "base",
    name: "drawings",
    listRule: own,
    viewRule: own,
    createRule: own,
    updateRule: own + ' && @request.body.owner:changed = false',
    deleteRule: own,
    fields: [
      { name: "owner", type: "relation", collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "title", type: "text", max: 500 },
      { name: "scene", type: "json", maxSize: 26214400 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  }));
}, () => {});
