# Admin redesign visual references

Generated: 5 September 2026

Mode: built-in Codex ImageGen, new raster image generation

Status: approved direction for implementation planning, not pixel-perfect UI

The images establish layout hierarchy, information density and component
relationships. Production copy, exact flag/coat assets, spacing and accessible
states remain governed by [19-admin-redesign.md](../../19-admin-redesign.md),
the MUI theme and the generated admin API contract.

## `content-workspace-v1.png`

Final prompt:

> Design a polished desktop admin console “Content workspace” for Country Flags
> in a 16:10 canvas. Use a calm light work surface, deep navy sidebar, cobalt
> actions, existing React Admin/MUI conventions, a visible DEV badge and current
> draft selector. Show the Edit → Validate → Review → Publish lifecycle, active
> release, draft status, needs-attention count, a work queue for European Coats
> and U.S. State Flags, validation summary and recent activity. Make it an
> editorial tool, not a generic analytics dashboard; no glassmorphism or neon.

## `entity-media-editor-v1.png`

Final prompt:

> Design the Germany GeoEntity editor on the Media tab in the same desktop admin
> system. Show breadcrumbs, entity identity and tabs for Overview, Names &
> locales, Facts, Media, Deck usage and History. The main canvas has contextual
> Flag and Coat of arms asset cards with large previews, provenance, license,
> localization status, Replace/Edit actions, a Public badge for the flag and a
> Paid-only badge for the coat. Add an Entity health rail with deck usage and a
> sticky Save/Validate bar. Never ask for a manual entity key.

## `deck-builder-v1.png`

Final prompt:

> Design the European Coats deck editor in the same admin system. The Content
> step uses three columns: a searchable/filterable card library with coat
> thumbnails and bulk add, an ordered resolved deck-member table supporting
> multiselect and drag ordering, and a sticky Deck summary with three public
> preview cards, entitlement, offer, missing-assets count and accidental-public-
> exposure warning. Include Details, Content, Presentation, Access & store and
> Review steps plus Save and Validate actions. Keep it dense, calm and obvious,
> using React Admin/MUI patterns without neon or mobile-app styling.
