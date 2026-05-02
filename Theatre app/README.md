# Theatre Database

A local browser app for recording theatre visits, cast pairings, attendees, and notes.

## Run the app

From this folder:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`.

## Import the initial spreadsheet

Place the spreadsheet in this folder, then run:

```powershell
& "C:\Users\amikn\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\import_spreadsheet.py ".\YOUR-SPREADSHEET.xlsx"
```

This writes `data/shows.json`. Reload the app and use Tools -> Reset Local Data if the browser has already cached an older local copy.

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

This app supports two modes:

- Local mode: empty `config.js`, using `data/shows.json` plus browser storage.
- Hosted mode: `config.js` contains Supabase project settings, requiring email sign-in and reading/writing shared Supabase tables.

### Supabase setup

1. Create a Supabase project.
2. Open the Supabase SQL editor.
3. Run `supabase/schema.sql`.
4. Run `supabase/seed.sql`.
5. In Authentication -> URL Configuration, add your Netlify production URL to the allowed redirect URLs.
6. In Authentication -> Providers, make sure Email is enabled. Magic links are the simplest sign-in option.

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

### Updating access later

Add or change users with SQL like this:

```sql
insert into public.app_users (email, display_name, role)
values ('person@example.com', 'Person', 'viewer')
on conflict (email) do update
set display_name = excluded.display_name,
    role = excluded.role;
```
