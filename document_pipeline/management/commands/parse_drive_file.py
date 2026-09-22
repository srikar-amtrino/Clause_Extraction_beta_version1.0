"""Run Steps 2.1 and 2.2 on one Drive file and show what came out.

This is the harness used to verify clause extraction. How it has been used:

    python manage.py parse_drive_file <drive_file_id>
    python manage.py parse_drive_file <drive_file_id> --output parse_output/result.json
    python manage.py parse_drive_file <drive_file_id> --save
    python manage.py parse_drive_file <drive_file_id> --file local/copy.docx --save --force

`--file` parses a copy already on disk instead of downloading, which needs no
Drive credentials: use it to re-parse a document after a parser change. The
file id is still required because it is what identifies the document, so the
run lands as that document's next attempt rather than creating a second one.

Without `--save` nothing is written to the database, so the command stays safe
to run against real documents purely to look at them: the summary goes to
stdout and `--output` dumps the full result as JSON. `--save` adds Step 2.3 and
persists the result; `--force` makes it write a new run even when the file has
not changed. `--rows` controls how many paragraph rows are previewed.

Verified with it so far:
  - Parity against the POC notebook across 15 real contracts, with no clause
    or statistic differences.
  - A live Drive run on an MSA and a DPA, checking breadcrumbs, page numbers
    and paragraph buckets against the source documents by hand.

Known limits it will show: page numbers are estimates, so files without
lastRenderedPageBreak markers undercount pages; canonical_path can disagree
with breadcrumbs where Word skips list levels.

Credentials come from the ingestion connector, which reuses the token saved by
the Google Drive login. The earlier direct-Drive-API path this command used is
kept commented out in `_drive_authorize.py` and `config/google_drive.py`.
"""
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from document_pipeline.connectors.GoogleDrive.main import get_credentials
from document_pipeline.models import Document
from document_pipeline.services.drive_service import DriveFileError, DriveFileRejected
from document_pipeline.services.ingestion_service import google_drive_source
from document_pipeline.services.parse_service import parse_local_file, stream_and_parse
from document_pipeline.services.persistence_service import persist_parse_result


class Command(BaseCommand):
    help = "Stream one Google Drive .docx into memory and extract its paragraph records."

    def add_arguments(self, parser):
        parser.add_argument("file_id", help="Google Drive file ID")
        parser.add_argument("--file", help="parse this local .docx instead of downloading "
                                           "from Drive; file_id still says which document "
                                           "it is, so the run lands on that document")
        parser.add_argument("--output", help="write the full result to this JSON file")
        parser.add_argument("--rows", type=int, default=25, help="paragraph rows to preview (default 25)")
        parser.add_argument("--save", action="store_true",
                            help="persist the result (Step 2.3); without it nothing is written")
        parser.add_argument("--force", action="store_true",
                            help="with --save, write a new run even if the file is unchanged")

    def handle(self, *args, **options):
        try:
            if options["file"]:
                result = parse_local_file(options["file"], options["file_id"],
                                          known=self._known(options["file_id"]))
            else:
                result = stream_and_parse(get_credentials(), options["file_id"])
        except (DriveFileError, DriveFileRejected) as exc:
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

        if options["save"]:
            self._save(result, force=options["force"])

        if options["output"]:
            path = Path(options["output"])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(result.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
            out.write(self.style.SUCCESS("\nfull result written to %s" % path))

    def _known(self, file_id):
        """The Drive metadata already stored for this file, so a local re-parse
        does not blank the web link or the name Drive gave it."""
        document = Document.objects.filter(source_external_id=file_id).first()
        if document is None:
            return {}
        return {"name": document.name, "mime_type": document.mime_type,
                "drive_web_link": document.drive_web_link}

    def _save(self, result, *, force):
        outcome = persist_parse_result(result, ingestion_source=google_drive_source(),
                                       force=force)
        out = self.stdout
        out.write("")
        out.write("document  : %s (%s)"
                  % (outcome.document.id, "new" if outcome.created else "existing"))
        if outcome.skipped:
            out.write(self.style.WARNING(
                "saved     : skipped, unchanged since run %s attempt %d"
                % (outcome.run.id, outcome.run.attempt)))
            return
        out.write(self.style.SUCCESS(
            "saved     : run %s attempt %d, %d clauses, %d paragraphs"
            % (outcome.run.id, outcome.run.attempt,
               outcome.clause_count, outcome.paragraph_count)))
        for issue in outcome.issues:
            out.write(self.style.WARNING("issue     : %s" % issue))
