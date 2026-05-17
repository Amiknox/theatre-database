-- Optional cleanup after the new normalized schema is verified.
-- Run this in the Supabase SQL editor only when you are sure the old table is unused.

drop table if exists public."Theatre";
