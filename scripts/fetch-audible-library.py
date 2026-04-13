#!/usr/bin/env python3
"""
Fetch Audible library and output JSON compatible with sync-audible.mjs.

Prerequisites:
  pip3 install audible-cli
  /Users/Kevin/Library/Python/3.9/bin/audible-quickstart  (run in Terminal.app)

Usage:
  python3 scripts/fetch-audible-library.py > library.json
  node scripts/sync-audible.mjs library.json
"""
import audible
import json
import sys
import re
from pathlib import Path


def clean_html(text):
    if not text:
        return ""
    return re.sub(r"<[^>]+>", "", text).strip()


def main():
    config_dir = Path.home() / ".audible"
    auth_files = [f for f in config_dir.glob("*.json") if f.is_file()]

    if not auth_files:
        print(
            "Error: No auth file found in ~/.audible/. Run audible-quickstart first.",
            file=sys.stderr,
        )
        sys.exit(1)

    auth_file = auth_files[0]
    print(f"Using auth: {auth_file.name}", file=sys.stderr)

    auth = audible.Authenticator.from_file(str(auth_file))
    with audible.Client(auth=auth) as client:
        response = client.get(
            "library",
            num_results=1000,
            response_groups="product_details,series,contributors,media,rating,product_images,listening_status",
        )

    items = response.get("items", [])
    print(f"Fetched {len(items)} items from Audible.", file=sys.stderr)

    books = []
    for item in items:
        authors = [a.get("name", "") for a in (item.get("authors") or []) if a.get("name")]
        narrators = [n.get("name", "") for n in (item.get("narrators") or []) if n.get("name")]
        series = [s.get("title", "") for s in (item.get("series") or []) if s.get("title")]
        categories = [
            ladder["ladder"][-1]["name"]
            for ladder in (item.get("category_ladders") or [])
            if ladder.get("ladder")
        ]

        product_images = item.get("product_images") or {}
        cover_url = (
            product_images.get("500")
            or product_images.get("256")
            or product_images.get("128")
            or ""
        )

        # listening_status may or may not be returned depending on Audible API version
        listening_status = item.get("listening_status") or {}
        percent_complete = listening_status.get("percent_complete")

        books.append(
            {
                "asin": item.get("asin", ""),
                "title": item.get("title", ""),
                "authors": authors,
                "narrators": narrators,
                "runtime_length_min": item.get("runtime_length_min", 0),
                "purchase_date": item.get("purchase_date", ""),
                "series": series,
                "categories": categories,
                "publisher": item.get("publisher_name", ""),
                "cover_url": cover_url,
                "percent_complete": percent_complete,
                "merchandising_summary": clean_html(item.get("merchandising_summary", "")),
                "publisher_summary": clean_html(item.get("publisher_summary", "")),
            }
        )

    json.dump(books, sys.stdout, indent=2)
    print(f"\nDone. {len(books)} books written to stdout.", file=sys.stderr)


if __name__ == "__main__":
    main()
