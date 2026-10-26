"""Classify every chunked document that needs it.

The stage after `chunk_documents`. Each document's current chunk run gets one
classification per micro chunk, against the configured taxonomy and model:

    python manage.py classify_documents
    python manage.py classify_documents --limit 5
    python manage.py classify_documents --document-id <uuid>
    python manage.py classify_documents --all --force

By default it touches only documents whose current chunk run has no current
classification run at the current taxonomy version, prompt version and model.
Changing any of those makes a document due again without --all -- the
selection compares versions, not merely whether a run exists. `--force`
writes a new run even when the current one is up to date.

This calls Bedrock and costs money. Run `check_bedrock` first in a new
environment, and `--dry-run` to see what would be classified.
"""
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Exists, OuterRef

from document_pipeline.classification.bedrock_client import (
    ConfigurationError,
    TransientError,
    classifier_from_settings,
)
from document_pipeline.classification.prompt import PROMPT_VERSION
from document_pipeline.models import ChunkRun, ClassificationRun, ExtractionRun
from document_pipeline.services.classification_service import classify_chunk_run


class Command(BaseCommand):
    help = "Classify the micro chunks of chunked documents against the canonical taxonomy."

    def add_arguments(self, parser):
        parser.add_argument("--document-id", help="classify only this document")
        parser.add_argument("--limit", type=int, help="stop after this many documents")
        parser.add_argument("--all", action="store_true",
                            help="revisit every chunked document, not just those due")
        parser.add_argument("--force", action="store_true",
                            help="write a new run even when the current one is up to date")
        parser.add_argument("--dry-run", action="store_true",
                            help="list what would be classified and stop")
        parser.add_argument("--concurrency", type=int,
                            help="parallel Bedrock requests (default CLASSIFY_CONCURRENCY)")

    def handle(self, *args, **options):
        try:
            classifier = classifier_from_settings()
        except ConfigurationError as exc:
            raise CommandError(str(exc))

        chunk_runs = self._select(options, classifier.model_id)
        if options["limit"]:
            chunk_runs = chunk_runs[:options["limit"]]
        if not chunk_runs:
            self.stdout.write("nothing to classify")
            return

        if options["dry_run"]:
            self.stdout.write("would classify %d document(s) with %s:"
                              % (len(chunk_runs), classifier.model_id))
            for chunk_run in chunk_runs:
                self.stdout.write("  %s  %s  (%d micro)"
                                  % (chunk_run.extraction_run.document_id,
                                     chunk_run.extraction_run.document_name,
                                     chunk_run.micro_count))
            return

        totals = {"classified": 0, "unchanged": 0, "warnings": 0, "review": 0,
                  "input": 0, "output": 0, "cache_read": 0}
        for chunk_run in chunk_runs:
            self._classify_one(chunk_run, classifier, totals, options)

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(
            "%d classified (%d with failed items), %d unchanged; %d paragraph(s) for review; "
            "tokens in %d / out %d / cache read %d"
            % (totals["classified"], totals["warnings"], totals["unchanged"], totals["review"],
               totals["input"], totals["output"], totals["cache_read"])))

    def _select(self, options, model_id):
        chunk_runs = (ChunkRun.objects
                      .filter(is_current=True,
                              extraction_run__is_current=True,
                              extraction_run__status__in=ExtractionRun.USABLE,
                              extraction_run__document__deleted_at__isnull=True)
                      .select_related("extraction_run")
                      .order_by("-created_at"))

        if options["document_id"]:
            chunk_run = chunk_runs.filter(
                extraction_run__document_id=options["document_id"]).first()
            if chunk_run is None:
                raise CommandError(
                    "No current chunk run for document %s. Run ingest_drive_files and "
                    "chunk_documents first." % options["document_id"])
            return [chunk_run]

        if options["all"]:
            return list(chunk_runs)
        up_to_date = ClassificationRun.objects.filter(
            chunk_run=OuterRef("pk"), is_current=True,
            taxonomy_version=settings.CLASSIFY_TAXONOMY_VERSION,
            prompt_version=PROMPT_VERSION, model_id=model_id)
        return list(chunk_runs.filter(~Exists(up_to_date)))

    def _classify_one(self, chunk_run, classifier, totals, options):
        label = chunk_run.extraction_run.document_name or str(chunk_run.extraction_run.document_id)
        try:
            outcome = classify_chunk_run(chunk_run, force=options["force"], classifier=classifier,
                                         concurrency=options["concurrency"])
        except ValueError as exc:
            totals["unchanged"] += 1
            self.stdout.write(self.style.ERROR("skipped      %s: %s" % (label, exc)))
            return
        except (ConfigurationError, ImproperlyConfigured) as exc:
            # Every remaining document would fail the same way.
            raise CommandError("stopped at %s: %s" % (label, exc))
        except TransientError as exc:
            raise CommandError("stopped at %s: Bedrock unavailable: %s. Already classified "
                               "documents are kept; re-run to continue." % (label, exc))

        run = outcome.run
        if outcome.skipped:
            totals["unchanged"] += 1
            self.stdout.write("unchanged    %s" % label)
            return
        if run.status == ClassificationRun.FAILED:
            raise CommandError("stopped at %s: %s" % (label, run.error_detail))

        totals["classified"] += 1
        totals["review"] += run.review_count
        totals["input"] += run.input_tokens
        totals["output"] += run.output_tokens
        totals["cache_read"] += run.cache_read_tokens
        line = ("%s %s: attempt %d, %d micro -> %d classified, %d unclassified, %d failed; "
                "%d for review; %d call(s)"
                % ("classified  " if run.failed_count == 0 else "with errors ", label,
                   run.attempt, run.micro_count, run.classified_count, run.unclassified_count,
                   run.failed_count, run.review_count, run.call_count))
        if run.failed_count:
            totals["warnings"] += 1
            self.stdout.write(self.style.WARNING(line))
        else:
            self.stdout.write(self.style.SUCCESS(line))
