-- 016_source_and_inquiry_mfr.sql
--  • Add "Website Submission" as a lead source.
--  • Add a manufacturer preference captured in the new-lead building inquiry.
-- Run each statement; ALTER TYPE ADD VALUE can't run inside a transaction with
-- other statements in some setups, so they're listed separately.

alter type lead_source add value if not exists 'website_submission';

alter table clients add column if not exists building_mfr text;  -- CCI | CA | SBSI | MMM
