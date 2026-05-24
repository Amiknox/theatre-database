import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd


ATTENDEES = ["Andrew", "Tina", "Mac", "Alice", "Jonathan", "Jo", "Oda", "Viv", "Adam"]


def clean(value):
    if pd.isna(value):
        return ""
    text = str(value).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", text).strip()


def date_to_iso(value):
    if pd.isna(value) or value == "":
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    parsed = pd.to_datetime(value, dayfirst=True, errors="coerce")
    if pd.isna(parsed):
        return clean(value)
    return parsed.date().isoformat()


def stable_id(show):
    base = "|".join([show["play"], show["dateSeen"], show["theatre"]]).lower()
    slug = re.sub(r"[^a-z0-9]+", "-", base).strip("-")
    return slug or "show"


def read_sheet(path):
    suffix = path.suffix.lower()
    if suffix in [".csv", ".tsv"]:
        sep = "\t" if suffix == ".tsv" else ","
        return pd.read_csv(path, header=None, sep=sep)
    return pd.read_excel(path, header=None)


def first_data_row(frame):
    for index, row in frame.iterrows():
        first_two = [clean(row.iloc[0]), clean(row.iloc[1]) if len(row) > 1 else ""]
        if first_two[0].lower() == "date" and first_two[1].lower() == "play":
            return index + 1
    return 2


def import_rows(frame):
    shows = []
    start = first_data_row(frame)
    for _, row in frame.iloc[start:].iterrows():
        play = clean(row.iloc[1] if len(row) > 1 else "")
        if not play:
            continue
        show = {
            "play": play,
            "dateSeen": date_to_iso(row.iloc[0] if len(row) > 0 else ""),
            "book": clean(row.iloc[2] if len(row) > 2 else ""),
            "music": "",
            "lyrics": "",
            "basedOn": "",
            "adaptedBy": clean(row.iloc[3] if len(row) > 3 else ""),
            "director": clean(row.iloc[4] if len(row) > 4 else ""),
            "theatre": clean(row.iloc[5] if len(row) > 5 else ""),
            "attendees": [],
            "notes": "",
            "cast": [],
        }

        for column in range(6, len(row), 2):
            character = clean(row.iloc[column])
            actor = clean(row.iloc[column + 1]) if column + 1 < len(row) else ""
            if character or actor:
                show["cast"].append({"character": character, "actor": actor})

        show["id"] = stable_id(show)
        shows.append(show)
    return shows


def merge_existing(existing_path, imported):
    if not existing_path.exists():
        return imported
    existing = json.loads(existing_path.read_text(encoding="utf-8"))
    current = existing.get("shows", [])
    by_id = {show.get("id"): show for show in current}
    for show in imported:
        candidate = show["id"]
        if candidate not in by_id:
            by_id[candidate] = show
            continue
        suffix = 2
        while f"{candidate}-{suffix}" in by_id:
            suffix += 1
        show["id"] = f"{candidate}-{suffix}"
        by_id[show["id"]] = show
    return list(by_id.values())


def main():
    parser = argparse.ArgumentParser(description="Import theatre spreadsheet rows into data/shows.json.")
    parser.add_argument("spreadsheet", help="Path to .xlsx, .xls, .csv, or .tsv file")
    parser.add_argument("--output", default="data/shows.json", help="Output JSON file")
    parser.add_argument("--merge", action="store_true", help="Merge with existing output instead of replacing it")
    args = parser.parse_args()

    spreadsheet = Path(args.spreadsheet)
    output = Path(args.output)
    if not spreadsheet.exists():
        print(f"Spreadsheet not found: {spreadsheet}", file=sys.stderr)
        return 1

    frame = read_sheet(spreadsheet)
    imported = import_rows(frame)
    shows = merge_existing(output, imported) if args.merge else imported
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"version": 1, "shows": shows}, indent=2), encoding="utf-8")
    print(f"Imported {len(imported)} entries into {output}")
    print("Attendees are not present in the source spreadsheet, so they are left blank.")
    print("Music, lyrics, run dates, and notes are also blank unless edited in the app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
