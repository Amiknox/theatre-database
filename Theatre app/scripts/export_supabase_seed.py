import json
from pathlib import Path


SOURCE = Path("data/shows.json")
OUTPUT = Path("supabase/seed.sql")


def sql(value):
    if value in ("", None):
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def main():
    data = json.loads(SOURCE.read_text(encoding="utf-8"))
    shows = data["shows"]
    lines = [
        "-- Generated from data/shows.json. Run supabase/schema.sql first.",
        "begin;",
        "truncate public.show_attendees, public.cast_members, public.shows restart identity cascade;",
        "",
    ]

    for show in shows:
        lines.append(
            "insert into public.shows "
            "(id, play, date_seen, book, music, lyrics, adapted_by, director, theatre, run_start, run_end, notes) values "
            f"({sql(show['id'])}, {sql(show['play'])}, {sql(show['dateSeen'])}, {sql(show['book'])}, "
            f"{sql(show['music'])}, {sql(show['lyrics'])}, {sql(show['adaptedBy'])}, {sql(show['director'])}, "
            f"{sql(show['theatre'])}, {sql(show['runStart'])}, {sql(show['runEnd'])}, {sql(show['notes'])}) "
            "on conflict (id) do update set "
            "play = excluded.play, date_seen = excluded.date_seen, book = excluded.book, "
            "music = excluded.music, lyrics = excluded.lyrics, adapted_by = excluded.adapted_by, "
            "director = excluded.director, theatre = excluded.theatre, run_start = excluded.run_start, "
            "run_end = excluded.run_end, notes = excluded.notes;"
        )

        for index, row in enumerate(show.get("cast", []), start=1):
            lines.append(
                "insert into public.cast_members (show_id, billing_order, character, actor) values "
                f"({sql(show['id'])}, {index}, {sql(row.get('character'))}, {sql(row.get('actor'))});"
            )

        for attendee in show.get("attendees", []):
            lines.append(
                "insert into public.show_attendees (show_id, attendee) values "
                f"({sql(show['id'])}, {sql(attendee)}) on conflict do nothing;"
            )

    lines.extend(["", "commit;", ""])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUTPUT} for {len(shows)} shows.")


if __name__ == "__main__":
    main()
