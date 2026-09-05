-- Which of a locked deck's cards were deliberately made public.
--
-- The editorial catalogue has carried `previewCards` since multi-content decks
-- landed, and the bundle validator has refused a preview that is not a member
-- of the deck previewing it; the publisher then dropped the list on the floor,
-- so at request time nothing could tell a preview from any other card of a
-- paid deck. The public content projection needs exactly that distinction: a
-- preview is the one deliberate exception to "an entitlement deck's material
-- is not served to a stranger", and an exception nobody can read back is not
-- an exception.
--
-- It belongs to the membership rather than to the card, because previewing is
-- a decision a deck makes: the same card may be a preview of one deck and an
-- ordinary member of another.
ALTER TABLE "public"."deck_cards"
  ADD COLUMN "is_preview" BOOLEAN NOT NULL DEFAULT false;
