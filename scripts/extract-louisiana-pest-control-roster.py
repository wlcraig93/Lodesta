#!/usr/bin/env python3
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber


def clean(value):
    if value is None:
        return ""
    return " ".join(str(value).replace("\n", " ").split())


parser = argparse.ArgumentParser(
    description="Extract the official Louisiana structural pest-control place-of-business PDF."
)
parser.add_argument("input_pdf")
parser.add_argument("output_json")
args = parser.parse_args()

input_path = Path(args.input_pdf).resolve()
output_path = Path(args.output_json).resolve()
raw_bytes = input_path.read_bytes()
records = []
page_counts = []

with pdfplumber.open(input_path) as document:
    for page_number, page in enumerate(document.pages, start=1):
        table = page.extract_table()
        if not table:
            raise RuntimeError(f"Page {page_number} did not contain an extractable table.")
        headers = [clean(value) for value in table[0]]
        expected = [
            "Account",
            "Business Name",
            "Address1",
            "Address2",
            "City",
            "Stat",
            "Zip",
            "Parish",
            "Phone",
            "Email",
            "Status",
            "Expire",
            "Contact",
        ]
        if headers != expected:
            raise RuntimeError(
                f"Page {page_number} has an unexpected header: {headers}"
            )
        extracted = 0
        for values in table[1:]:
            row = {header: clean(values[index]) for index, header in enumerate(headers)}
            if not row["Account"] or not row["Business Name"]:
                continue
            row["sourcePage"] = page_number
            records.append(row)
            extracted += 1
        page_counts.append({"page": page_number, "records": extracted})

account_ids = [record["Account"] for record in records]
duplicates = sorted(
    {account_id for account_id in account_ids if account_ids.count(account_id) > 1}
)
if duplicates:
    raise RuntimeError(f"Duplicate permit accounts in PDF extraction: {duplicates}")

payload = {
    "schemaVersion": 1,
    "sourceUrl": "https://www.ldaf.la.gov/business/pest-control/pest-control-licensing",
    "documentTitle": "Structural Place of Business Permits - Revised: April 20, 2026",
    "documentDate": "2026-04-20T00:00:00.000Z",
    "extractedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "sourceHash": hashlib.sha256(raw_bytes).hexdigest(),
    "coverageStatus": "complete",
    "pageCount": len(page_counts),
    "pageCounts": page_counts,
    "recordCount": len(records),
    "records": records,
}

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(
    json.dumps(
        {
            "outputPath": str(output_path),
            "pageCount": len(page_counts),
            "recordCount": len(records),
            "sourceHash": payload["sourceHash"],
        },
        indent=2,
    )
)
