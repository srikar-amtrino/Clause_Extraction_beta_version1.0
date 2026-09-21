"""Parse and persist every Drive document that needs it.

The other half of Step 2.4. `POST /api/google-drive/sync/` records what exists
in Drive and queues changed files for Celery; this command remains available
for manual or recovery ingestion:

    python manage.py ingest_drive_files
    python manage.py ingest_drive_files --limit 5
    python manage.py ingest_drive_files --file-id <drive_file_id>
    python manage.py ingest_drive_files --all --force

Downloads are the slow part, so this is a command rather than something the
sync request does inline: a folder of forty contracts would otherwise hold a
request open for minutes. Without a task queue, a human or a cron runs this.

By default it only touches documents whose Drive modified time is newer than
the run we already hold, so re-running it over an unchanged corpus costs
nothing. `--all` ignores that check, `--force` also overrides the content-hash
check inside the writer.
"""
from django.core.management.base import BaseCommand, CommandError

from document_pipeline.connectors.GoogleDrive.main import get_credentials
from document_pipeline.models import Document
from document_pipeline.services.drive_service import DriveFileError
from document_pipeline.services.ingestion_service import (
    google_drive_source,
    ingest_document,
    pending_documents,
)


class Command(BaseCommand):
    help = "Download, parse and persist Drive documents recorded by the sync endpoint."

    def add_arguments(self, parser):
        parser.add_argument("--file-id", help="ingest only this Drive file id")
        parser.add_argument("--limit", type=int, help="stop after this many documents")
        parser.add_argument("--all", action="store_true",
                            help="ignore the modified-time check and revisit every document")
        parser.add_argument("--force", action="store_true",
                            help="write a new run even when the content is unchanged")
        parser.add_argument("--dry-run", action="store_true",
                            help="list what would be ingested and stop")

    def handle(self, *args, **options):
        source = google_drive_source()
        documents = self._select(source, options)
        if options["limit"]:
            documents = documents[:options["limit"]]

        if not documents:
            self.stdout.write("nothing to ingest")
            return

        if options["dry_run"]:
            self.stdout.write("would ingest %d document(s):" % len(documents))
            for document in documents:
                self.stdout.write("  %s  %s" % (document.source_external_id, document.name))
            return

        credentials = get_credentials()
        counts = {"saved": 0, "skipped": 0, "rejected": 0, "failed": 0}
        for document in documents:
            self._ingest_one(credentials, document, counts, force=options["force"])

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            "%d saved, %d unchanged, %d rejected, %d failed"
            % (counts["saved"], counts["skipped"], counts["rejected"], counts["failed"])))

    def _select(self, source, options):
        if options["file_id"]:
            try:
                return [Document.objects.get(ingestion_source=source,
                                             source_external_id=options["file_id"])]
            except Document.DoesNotExist:
                raise CommandError(
                    "No document for Drive file %s. Run the sync endpoint first."
                    % options["file_id"])
        if options["all"]:
            return list(Document.objects.filter(ingestion_source=source,
                                                deleted_at__isnull=True))
        return pending_documents(source)

    def _ingest_one(self, credentials, document, counts, *, force):
        label = document.name or document.source_external_id
        try:
            outcome = ingest_document(credentials, document, force=force)
        except DriveFileError as exc:
            # Drive itself failed, so a retry may work. Leave the document
            # alone rather than recording a parse failure that is not one.
            counts["failed"] += 1
            self.stdout.write(self.style.ERROR("drive error  %s: %s" % (label, exc)))
            return

        run = outcome.run
        if outcome.skipped:
            counts["skipped"] += 1
            self.stdout.write("unchanged    %s" % label)
        elif run.status == "rejected":
            counts["rejected"] += 1
            reason = (run.rejection or {}).get("reason", "")
            self.stdout.write(self.style.WARNING("rejected     %s: %s" % (label, reason)))
        elif run.is_usable:
            counts["saved"] += 1
            self.stdout.write(self.style.SUCCESS(
                "saved        %s: attempt %d, %d clauses, %d paragraphs"
                % (label, run.attempt, outcome.clause_count, outcome.paragraph_count)))
        else:
            counts["failed"] += 1
            reason = (run.rejection or {}).get("reason", "")
            self.stdout.write(self.style.ERROR("failed       %s: %s" % (label, reason)))

        for issue in outcome.issues:
            self.stdout.write(self.style.WARNING("  issue: %s" % issue))
