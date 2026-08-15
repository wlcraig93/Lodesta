-- A named contact is unique within a business by normalized person name.
-- Email and phone are attributes, not identity keys, because small-business
-- contacts commonly share a general inbox or business line.

create unique index prospect_contacts_business_name_idx
  on public.prospect_contacts(prospect_id, lower(btrim(full_name)));
