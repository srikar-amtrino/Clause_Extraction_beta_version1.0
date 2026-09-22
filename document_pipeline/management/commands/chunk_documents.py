"""Chunk every parsed document that needs it.

The stage after `ingest_drive_files`. That command downloads and parses; this
turns each stored clause tree into the macro and micro chunks retrieval and
citation are built on:

    python manage.py chunk_documents
    python manage.py chunk_documents --limit 5
    python manage.py chunk_documents --document-id <uuid>
    python manage.py chunk_documents --all --force

By default it only touches current, usable extraction runs that have no chunk
run at the current CHUNKER_VERSION, so re-running it over an already chunked
corpus costs nothing. `--all` revisits every usable run, `--force` writes a new
chunk run even when the existing one is already current.

Chunking is pure computation over rows already in the database -- no Drive, no
network -- so this is safe to re-run at any time.
"""
from django.core.management.base import BaseCommand, CommandError

from document_pipeline.models import ExtractionRun
from document_pipeline.services.chunking_service import chunk_extraction_run


class Command(BaseCommand):
    help = "Build macro and micro chunks from stored extraction runs."

    def add_arguments(self, parser):
        parser.add_argument("--document-id", help="chunk only this document's current run")
        parser.add_argument("--limit", type=int, help="stop after this many runs")
        parser.add_argument("--all", action="store_true",
                            help="revisit every usable run, not just unchunked ones")
        parser.add_argument("--force", action="store_true",
                            help="write a new chunk run even when one is already current")
        parser.add_argument("--dry-run", action="store_true",
                            help="list what would be chunked and stop")

    def handle(self, *args, **options):
        runs = self._select(options)
        if options["limit"]:
            runs = runs[:options["limit"]]

        if not runs:
            self.stdout.write("nothing to chunk")
            return

        if options["dry_run"]:
            self.stdout.write("would chunk %d run(s):" % len(runs))
            for run in runs:
                self.stdout.write("  %s  %s" % (run.id, run.document_name))
            return

        counts = {"chunked": 0, "skipped": 0, "incomplete": 0}
        for run in runs:
            self._chunk_one(run, counts, force=options["force"])

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            "%d chunked, %d unchanged, %d with coverage gaps"
            % (counts["chunked"], counts["skipped"], counts["incomplete"])))

    def _select(self, options):
        usable = ExtractionRun.objects.filter(
            is_current=True, status__in=ExtractionRun.USABLE,
            document__deleted_at__isnull=True,
        ).order_by('-created_at')

        if options["document_id"]:
            run = usable.filter(document_id=options["document_id"]).first()
            if run is None:
                raise CommandError(
                    "No current usable extraction run for document %s. "
                    "Run ingest_drive_files first." % options["document_id"])
            return [run]

        if options["all"]:
            return list(usable)
        # A run whose current chunk run is already at this chunker version has
        # nothing new to produce; the service re-checks this anyway.
        return list(usable.exclude(chunk_runs__is_current=True))

    def _chunk_one(self, run, counts, *, force):
        label = run.document_name or str(run.document_id)
        try:
            outcome = chunk_extraction_run(run, force=force)
        except ValueError as exc:
            counts["skipped"] += 1
            self.stdout.write(self.style.ERROR("skipped      %s: %s" % (label, exc)))
            return

        chunk_run = outcome.chunk_run
        if outcome.skipped:
            counts["skipped"] += 1
            self.stdout.write("unchanged    %s" % label)
            return
        elif chunk_run.is_complete:
            counts["chunked"] += 1
            self.stdout.write(self.style.SUCCESS(
                "chunked      %s: attempt %d, %d chunks (%d macro, %d micro, %d indexed)"
                % (label, chunk_run.attempt, chunk_run.chunk_count,
                   chunk_run.macro_count, chunk_run.micro_count, chunk_run.indexed_count)))
        else:
            # A clause no search can reach, or a paragraph no chunk carries,
            # breaks the trail from a verdict back to the source text.
            counts["chunked"] += 1
            counts["incomplete"] += 1
            stats = chunk_run.stats
            self.stdout.write(self.style.WARNING(
                "coverage gap %s: %d chunks, %d unreachable clause(s), "
                "%d missing paragraph(s)"
                % (label, chunk_run.chunk_count,
                   len(stats.get("clauses_unreachable") or []),
                   len(stats.get("paragraphs_missing") or []))))

        for issue in outcome.issues:
            self.stdout.write(self.style.WARNING("  issue: %s" % issue))

        self.stdout.write("classification queued automatically (batches run in parallel)")
