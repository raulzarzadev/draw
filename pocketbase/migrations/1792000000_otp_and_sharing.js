migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;
  users.updateRule = 'id = @request.auth.id && @request.body.verified:changed = false && @request.body.email:changed = false';
  users.otp.enabled = true;
  users.otp.length = 8;
  users.otp.duration = 600;
  users.passwordAuth.enabled = false;
  app.save(users);

  const drawings = app.findCollectionByNameOrId("drawings");
  drawings.fields.add(new SelectField({ name: "share_mode", values: ["restricted", "view", "edit"], maxSelect: 1 }));
  drawings.fields.add(new TextField({ name: "share_token", max: 64 }));
  const owner = '@request.auth.id != "" && owner = @request.auth.id';
  const admin = '@request.auth.verified = true && @request.auth.email = "raulzarza.dev@gmail.com"';
  const shared = '(share_mode = "view" || share_mode = "edit") && share_token != "" && @request.query.share_token = share_token';
  drawings.listRule = `(${owner}) || (${admin}) || (${shared})`;
  drawings.viewRule = drawings.listRule;
  drawings.createRule = `${owner} && (@request.body.share_mode:isset = false || @request.body.share_mode = "restricted") && (@request.body.share_token:isset = false || @request.body.share_token = "")`;
  drawings.updateRule = `@request.body.owner:changed = false && ((${owner}) || (share_mode = "edit" && share_token != "" && @request.query.share_token = share_token && @request.body.share_mode:changed = false && @request.body.share_token:changed = false))`;
  drawings.deleteRule = `(${owner}) || (${admin})`;
  app.save(drawings);
  users.listRule = admin;
  users.viewRule = `id = @request.auth.id || (${admin})`;
  app.save(users);
  for (const name of ["draw_settings", "drawing_limits"]) {
    const collection = app.findCollectionByNameOrId(name);
    collection.createRule = admin;
    collection.updateRule = admin;
    collection.deleteRule = admin;
    if (name === "drawing_limits") {
      collection.listRule = `(${owner}) || (${admin})`;
      collection.viewRule = collection.listRule;
    }
    for (const field of ["created", "updated"]) {
      if (!collection.fields.getByName(field)) collection.fields.add(new AutodateField({ name: field, onCreate: true, onUpdate: field === "updated" }));
    }
    app.save(collection);
  }
}, () => {});
