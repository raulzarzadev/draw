# PocketBase sharing setup

The web app expects two additional fields in the existing `drawings` collection.

| Field | Type | Configuration |
| --- | --- | --- |
| `share_mode` | Select | Single value; options: `restricted`, `view`, `edit`; default: `restricted` |
| `share_token` | Text | Maximum 64 characters; not required |

Keep the existing `owner`, `title`, and `scene` fields. Configure the collection rules as follows.

## List and view

```text
owner = @request.auth.id || (share_mode != "restricted" && share_token != "" && @request.query.share_token = share_token)
```

## Create

```text
@request.auth.id != "" && owner = @request.auth.id && (@request.body.share_mode:isset = false || @request.body.share_mode = "restricted") && @request.body.share_token:isset = false
```

## Update

```text
@request.auth.id != "" && @request.body.owner:changed = false && (owner = @request.auth.id || (share_mode = "edit" && share_token != "" && @request.query.share_token = share_token && @request.body.share_mode:changed = false && @request.body.share_token:changed = false))
```

## Delete

```text
owner = @request.auth.id
```

Disabling sharing clears `share_token`, so previously copied links stop working. Enabling it again creates a new cryptographically random token.

Apply migration `1792000200_require_login_for_shared_edit.js` to enforce sign-in
for shared editing on the backend. Valid shared links remain viewable without
sign-in. A signed-in user still needs an editable link to write; view-only links
never grant editing. The laser endpoint uses the same update permission.
