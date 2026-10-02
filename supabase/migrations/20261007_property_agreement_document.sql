-- Owner management agreements tab (Fee Management → Agreements).
--
-- AppFolio's API can't list documents, so staff paste the link to the latest
-- signed agreement (always a link into AppFolio) and the date it was last
-- renewed, which tells us which version of the agreement the owner is on.

ALTER TABLE property_agreement
  ADD COLUMN IF NOT EXISTS agreement_url TEXT,
  ADD COLUMN IF NOT EXISTS last_renewed_on DATE;

ALTER TABLE property_agreement DROP CONSTRAINT IF EXISTS property_agreement_url_appfolio;
ALTER TABLE property_agreement ADD CONSTRAINT property_agreement_url_appfolio
  CHECK (agreement_url IS NULL OR agreement_url LIKE 'https://highdesertpm.appfolio.com/%');
