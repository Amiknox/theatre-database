# Theatre Database

A browser app for recording theatre visits, cast pairings, attendees, and notes in the live Supabase database.

## Run the app

From this folder:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Database source of truth

The live Supabase project is the source of truth. Spreadsheet files are source/import artifacts only and are intentionally ignored by Git.

The app reads and writes the normalized Supabase tables in `supabase/schema.sql`. The local `data/shows.json` and import/export scripts are legacy migration aids, not the active database.

## Legacy spreadsheet import

For one-off migration work, place a spreadsheet in this folder, then run:

```powershell
& "C:\Users\amikn\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\import_spreadsheet.py ".\YOUR-SPREADSHEET.xlsx"
```

This writes `data/shows.json`. `Music`, `Lyrics`, and `Based on` are not present in the source spreadsheet, so they are left blank. Use `scripts/export_supabase_seed.py` only when intentionally regenerating the SQL seed for a fresh Supabase setup.

The importer maps:

- Column A `Date` -> `Date seen`
- Column B `Play` -> `Play`
- Column C `Author` -> `Book`
- Column D `Adapted by` -> `Adapted by`
- Column E `Director` -> `Director`
- Column F `Theatre` -> `Theatre`
- Columns G onward -> cast pairs, character first and actor second

## Scraping

Scraping theatre websites is feasible, but it should be treated as assisted import rather than trusted automatic entry. Theatre pages have inconsistent markup, change often, and browser security can block direct fetching. The Tools screen can fetch when a site allows it, or parse pasted page text/HTML into a draft entry for review.

## Hosting with Netlify and Supabase

This app expects `config.js` to contain Supabase project settings. Users sign in by email and read/write the shared Supabase tables.

When Supabase is unavailable or the user is signed out, database reads and writes are paused. This keeps configuration or sign-in failures visible instead of making the app appear to work from stale local data.

### Supabase setup

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run `supabase/schema.sql`.
4. Run `supabase/seed.sql`.
5. In Authentication -> URL Configuration, add your Netlify production URL to the allowed redirect URLs.
6. In Authentication -> Providers, make sure Email is enabled. Magic links are the simplest sign-in option.

After sign-in, the Tools screen shows exact Supabase row counts for `shows`, `cast_members`, `show_attendees`, and `app_users`.

Initial access is set in `supabase/schema.sql`:

- Andrew, `amiknox@protonmail.com`, `admin`
- Tina, `tina.isaacsknox@gmail.com`, `editor`

Role meanings:

- `viewer`: can search and view records.
- `editor`: can add, edit, and delete theatre records.
- `admin`: can also manage rows in `app_users`.

### Netlify setup

1. Put this folder in a Git repository.
2. Create a new Netlify site from that repository.
3. Netlify will read `netlify.toml`.
4. Add these environment variables in Netlify:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. Deploy the site.

The Supabase anon key is intended to be public in browser apps when Row Level Security is enabled. Do not put the Supabase service role key in Netlify or frontend code.

### Legacy table cleanup

Older setup work may have left a single unused `public."Theatre"` table in Supabase. Once the normalized tables above have been verified, run `supabase/cleanup_old_theatre_table.sql` in the Supabase SQL editor to remove it.

### Updating access later

Add or change users with SQL like this:

```sql
insert into public.app_users (email, display_name, role)
values ('person@example.com', 'Person', 'viewer')
on conflict (email) do update
set display_name = excluded.display_name,
    role = excluded.role;
```
