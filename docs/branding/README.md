# Draw identity

- `draw-logo-proposal.png`: original transparent proposal generated with the built-in imagegen tool.
- `public/icons/draw.svg`: simplified vector interpretation for the favicon.
- `public/icons/icon-*.png`: opaque app icons with padding for masking and iOS.

Regenerate PNG icons on macOS: `swift scripts/generate-icons.swift "$PWD/public/icons"`.

Generation prompt: A subtle, descriptive logo for Draw, a collaborative whiteboard: a monoline D combined with an open canvas and pencil stroke, beside the word Draw. Charcoal with a restrained muted violet accent; flat, minimal, legible at small sizes; transparent background; no shadows or extra text.

## Dark-background variant

`draw-logo-dark-proposal.png` is the imagegen color study: soft white lettering and
symbol with lighter violet accents, on transparency. Prompt: preserve the original
Draw arrangement and proportions; recolor charcoal parts to #F5F5F7 and violet
accents to #A79BEF for dark-background contrast. The production favicon uses the
clean vector `public/icons/draw-dark.svg`, selected by the browser's color scheme.

## D-only icon

`public/icons/draw-d-icon.png`: square variant generated with built-in imagegen.
Prompt: extract the D symbol, preserve its pencil and freehand stroke, remove the
word Draw, use soft white #F5F5F7 and violet #A79BEF on charcoal #18191C, centered
with generous margins for app icon masks, without text or mockups.
