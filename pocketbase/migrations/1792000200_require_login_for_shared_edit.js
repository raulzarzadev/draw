migrate((app) => {
  const drawings = app.findCollectionByNameOrId("drawings");
  const owner = 'owner = @request.auth.id';
  const editor = 'share_mode = "edit" && share_token != "" && @request.query.share_token = share_token && @request.body.share_mode:changed = false && @request.body.share_token:changed = false';
  // Viewing remains available via a valid link. All writes require an account.
  drawings.updateRule = `@request.auth.id != "" && @request.body.owner:changed = false && ((${owner}) || (${editor}))`;
  app.save(drawings);
}, (app) => {
  const drawings = app.findCollectionByNameOrId("drawings");
  const owner = '@request.auth.id != "" && owner = @request.auth.id';
  drawings.updateRule = `@request.body.owner:changed = false && ((${owner}) || (share_mode = "edit" && share_token != "" && @request.query.share_token = share_token && @request.body.share_mode:changed = false && @request.body.share_token:changed = false))`;
  app.save(drawings);
});
