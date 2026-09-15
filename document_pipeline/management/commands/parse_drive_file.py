"""Run Steps 2.1 and 2.2 on one Drive file and show what came out.

Uses the development credentials from `drive_authorize`. Nothing is written to
the database. `--output` writes the full result as JSON for inspection.
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from config.google_drive import load_dev_credentials
from document_pipeline.services.drive_service import DriveFileError
from document_pipeline.services.parse_service import stream_and_parse


class Command(BaseCommand):
    help = "Stream one Google Drive .docx into memory and extract its paragraph records."

    def add_arguments(self, parser):
        parser.add_argument("file_id", help="Google Drive file ID")
        parser.add_argument("--output", help="write the full result to this JSON file")
        parser.add_argument("--rows", type=int, default=25, help="paragraph rows to preview (default 25)")

    def handle(self, *args, **options):
        try:
            result = stream_and_parse(load_dev_credentials(), options["file_id"])
        except DriveFileError as exc:
            raise CommandError(str(exc)) from exc

        out = self.stdout
        src = result.source or {}
        out.write("file      : %s (%s bytes)" % (src.get("name"), src.get("file_size_bytes")))
        out.write("status    : %s" % result.status)
        if result.rejection:
            out.write("reason    : %s" % result.rejection["reason"])
            if result.rejection.get("remedy"):
                out.write("remedy    : %s" % result.rejection["remedy"])

        if result.is_usable:
            s = result.stats
            out.write("title     : %s" % result.document_title)
            out.write("clauses   : %d, deepest level %d, by level %s"
                      % (s["clause_count"], s["max_level"], s["clauses_by_level"]))
            out.write("paragraphs: %d records, buckets %s" % (s["paragraph_records"], s["paragraph_buckets"]))
            out.write("pages     : %d (%s)" % (s["page_count"], s["page_source"]))
            out.write("timings   : %s ms" % result.timings_ms)
            for w in result.warnings:
                out.write(self.style.WARNING("warning   : %s - %s" % (w["code"], w["detail"])))

            out.write("\n%-7s %-4s %-14s %s" % ("id", "page", "bucket", "breadcrumbs | text"))
            for p in result.paragraphs[:options["rows"]]:
                out.write("%-7s %-4d %-14s %s | %s"
                          % (p.paragraph_id, p.page_number, p.bucket, " > ".join(p.breadcrumbs), p.text[:70]))
            if len(result.paragraphs) > options["rows"]:
                out.write("... %d more" % (len(result.paragraphs) - options["rows"]))

        if options["output"]:
            path = Path(options["output"])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
            out.write(self.style.SUCCESS("\nfull result written to %s" % path))
