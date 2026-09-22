"""Where every document stands in the pipeline, and what is missing.

The whole flow -- Drive, parsing, chunking, classification -- writes its own
run rows, each with its own counters. This reads them back together and asks
one question per stage: is anything that should have reached this stage not
here?

    python manage.py pipeline_status
    python manage.py pipeline_status --detail
    python manage.py pipeline_status --document-id <uuid>

`--detail` names the documents behind each number instead of counting them.
Exit status is 1 when anything is missing or incomplete, so a run can be
checked from a script:

    python manage.py pipeline_status || echo "pipeline has gaps"

Nothing is written and nothing is downloaded: this only reads.
"""
import sys

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Exists, F, OuterRef

from document_pipeline.chunking.builder import CHUNK_SCHEMA_VERSION
from document_pipeline.classification.prompt import PROMPT_VERSION
from document_pipeline.models import (
    ChunkRun,
    Classification,
    ClassificationRun,
    Document,
    ExtractionRun,
)
from document_pipeline.parsing.result import SCHEMA_VERSION
from document_pipeline.services.ingestion_service import DOCX_MIME, google_drive_source

# How many names --detail prints before it stops listing.
DETAIL_LIMIT = 40


class Command(BaseCommand):
    help = "Report what each pipeline stage holds and what has not reached it."

    def add_arguments(self, parser):
        parser.add_argument("--document-id", help="report on this document alone")
        parser.add_argument("--detail", action="store_true",
                            help="name the documents behind each gap")
        parser.add_argument("--model-id", help="the classification model to measure "
                                               "staleness against (default CLASSIFY_MODEL_ID)")

    def handle(self, *args, **options):
        documents = self._documents(options)
        if not documents.exists():
            raise CommandError("No documents. Run the Drive sync first.")

        self.detail = options["detail"]
        self.model_id = options["model_id"] or settings.CLASSIFY_MODEL_ID
        gaps = 0

        gaps += self._sync(documents)
        parsed = self._parsing(documents)
        gaps += parsed["gaps"]
        gaps += self._chunking(parsed["runs"])
        gaps += self._classification(parsed["runs"])

        self.stdout.write("")
        if gaps:
            self.stdout.write(self.style.WARNING(
                "%d gap(s). Re-run the stages above; --detail names the documents." % gaps))
            sys.exit(1)
        self.stdout.write(self.style.SUCCESS(
            "no gaps: every parseable document is parsed, chunked and classified, "
            "with full clause and paragraph coverage."))

    # ------------------------------------------------------------------ stages

    def _documents(self, options):
        documents = Document.objects.filter(ingestion_source=google_drive_source(),
                                            deleted_at__isnull=True)
        if options["document_id"]:
            documents = documents.filter(pk=options["document_id"])
            if not documents.exists():
                raise CommandError("No document %s." % options["document_id"])
        return documents

    def _sync(self, documents):
        """Stage 1. What Drive holds, split by whether the pipeline parses it."""
        total = documents.count()
        docx = documents.filter(mime_type=DOCX_MIME)
        other = documents.exclude(mime_type=DOCX_MIME)

        self._head("drive", "%d document(s)" % total)
        self._line("parseable (.docx)", docx.count())
        # Not a gap: a PDF or a native Google Doc has no .docx bytes to parse,
        # and the format gate refuses it by design. Counted so the number of
        # documents the later stages work on is never a surprise.
        self._line("out of scope", other.count(),
                   note="not .docx - no clause extraction path")
        self._names(other, "out of scope", mime=True)
        return 0

    def _parsing(self, documents):
        """Stage 2. Every .docx should hold a current, usable extraction run
        built by the parser this checkout would run."""
        docx = documents.filter(mime_type=DOCX_MIME)
        runs = ExtractionRun.objects.filter(document__in=docx, is_current=True)
        usable = runs.filter(status__in=ExtractionRun.USABLE)

        never = docx.filter(extraction_runs__isnull=True)
        rejected = runs.filter(status=ExtractionRun.REJECTED)
        failed = runs.exclude(status__in=ExtractionRun.USABLE).exclude(
            status=ExtractionRun.REJECTED)
        stale = usable.exclude(parser_build=settings.PARSER_BUILD,
                               schema_version=SCHEMA_VERSION)

        self._head("parsing", "%d usable run(s), %d clause(s), %d paragraph(s)"
                   % (usable.count(),
                      sum(usable.values_list("clause_count", flat=True)),
                      sum(usable.values_list("paragraph_count", flat=True))))
        gaps = 0
        gaps += self._gap("never parsed", never, "run ingest_drive_files")
        gaps += self._gap("parse failed", failed, "see the run's rejection reason")
        gaps += self._gap("stale parser build", stale,
                          "parsed by an older build than %s; re-run ingest_drive_files"
                          % settings.PARSER_BUILD)
        # A .docx the format gate refused is a real answer about the file, not
        # a stage that failed to run, so it is reported without counting.
        self._line("rejected by the format gate", rejected.count(),
                   note="not really a .docx; the file has to change")
        self._names(rejected.select_related("document"), "rejected", reason=True)
        return {"gaps": gaps, "runs": usable}

    def _chunking(self, usable_runs):
        """Stage 3. Every usable run should hold a current chunk run that
        reaches every clause and carries every paragraph."""
        chunk_runs = ChunkRun.objects.filter(extraction_run__in=usable_runs, is_current=True)
        current = chunk_runs.filter(chunker_version=settings.CHUNKER_VERSION,
                                    chunk_schema_version=CHUNK_SCHEMA_VERSION)

        unchunked = usable_runs.filter(~Exists(
            ChunkRun.objects.filter(extraction_run=OuterRef("pk"), is_current=True)))
        stale = chunk_runs.exclude(pk__in=current.values("pk"))
        incomplete = chunk_runs.filter(all_clauses_covered=False) \
            | chunk_runs.filter(all_paragraphs_covered=False) \
            | chunk_runs.filter(all_clauses_retrievable=False)

        self._head("chunking", "%d chunk run(s), %d chunk(s) (%d macro, %d micro)"
                   % (chunk_runs.count(),
                      sum(chunk_runs.values_list("chunk_count", flat=True)),
                      sum(chunk_runs.values_list("macro_count", flat=True)),
                      sum(chunk_runs.values_list("micro_count", flat=True))))
        gaps = 0
        gaps += self._gap("not chunked", unchunked, "run chunk_documents")
        gaps += self._gap("stale chunker version", stale,
                          "chunked before %s; re-run chunk_documents"
                          % settings.CHUNKER_VERSION)
        # The one gap that loses text rather than delaying it: a clause no
        # chunk reaches, or a paragraph no chunk carries, cannot be classified
        # and cannot be cited back to its source.
        gaps += self._gap("coverage gap", incomplete.distinct(),
                          "a clause or paragraph no chunk carries")
        self._coverage(incomplete.distinct())
        return gaps

    def _classification(self, usable_runs):
        """Stage 4. Every micro chunk should carry a classification from the
        taxonomy, prompt and model this checkout would use."""
        chunk_runs = ChunkRun.objects.filter(extraction_run__in=usable_runs, is_current=True)
        attempts = ClassificationRun.objects.filter(chunk_run__in=chunk_runs)
        runs = attempts.filter(is_current=True)
        finished = runs.filter(status__in=ClassificationRun.FINISHED_OK)

        current = dict(taxonomy_version=settings.CLASSIFY_TAXONOMY_VERSION,
                       prompt_version=PROMPT_VERSION, model_id=self.model_id)
        unclassified = chunk_runs.filter(~Exists(
            ClassificationRun.objects.filter(chunk_run=OuterRef("pk"), is_current=True)))
        stale = runs.exclude(**current)
        # A run that failed, or one a killed process left open, is never
        # promoted to current -- so looking only at current runs hides a
        # failure exactly when it matters. These are the attempts on documents
        # that still have no answer.
        failed = attempts.filter(status=ClassificationRun.FAILED, chunk_run__in=unclassified)
        stuck = attempts.filter(status=ClassificationRun.RUNNING, chunk_run__in=unclassified)
        # A run that finished while leaving micro chunks unanswered: the
        # document looks classified, and some of its clauses have no verdict.
        partial = finished.filter(classified_count__lt=F("micro_count"))

        micro = sum(chunk_runs.values_list("micro_count", flat=True))
        done = sum(finished.values_list("classified_count", flat=True))
        self._head("classification", "%d/%d micro chunk(s) classified in %d run(s)"
                   % (done, micro, runs.count()))
        rows = Classification.objects.filter(run__in=finished)
        self._line("clause / non-clause split", "",
                   note="%d clause, %d non-clause, %d unclassified, %d failed, %d for review"
                        % (rows.filter(label=Classification.CLAUSE).count(),
                           rows.filter(label=Classification.NON_CLAUSE).count(),
                           rows.filter(outcome=Classification.UNCLASSIFIED).count(),
                           rows.filter(outcome=Classification.FAILED).count(),
                           rows.filter(needs_review=True).count()))
        gaps = 0
        gaps += self._gap("not classified", unclassified, "run classify_documents")
        gaps += self._gap("classification failed", failed, "see error_detail on the run")
        gaps += self._gap("left running (worker died mid-run)", stuck,
                          "the next attempt closes it; re-run classify_documents")
        gaps += self._gap("stale taxonomy / prompt / model", stale,
                          "classified against an older %s / %s / model"
                          % (settings.CLASSIFY_TAXONOMY_VERSION, PROMPT_VERSION))
        gaps += self._gap("micro chunks left unanswered", partial,
                          "re-run classify_documents --force for these documents")
        return gaps

    # ------------------------------------------------------------------ output

    def _head(self, name, summary):
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("%-16s %s" % (name, summary)))

    def _line(self, label, count, note=""):
        self.stdout.write("  %-34s %6s  %s" % (label, count, note))

    def _gap(self, label, queryset, remedy):
        count = queryset.count()
        if not count:
            self._line(label, 0)
            return 0
        self.stdout.write(self.style.WARNING("  %-34s %6d  %s" % (label, count, remedy)))
        self._names(queryset, label)
        return count

    def _names(self, queryset, label, mime=False, reason=False):
        if not self.detail:
            return
        for row in queryset[:DETAIL_LIMIT]:
            document = _document_of(row)
            extra = ""
            if mime:
                extra = "  [%s]" % (document.mime_type or "unknown")
            elif reason:
                extra = "  %s" % ((getattr(row, "rejection", None) or {}).get("reason", ""))
            self.stdout.write("      %s%s" % (document.name or document.id, extra))
        remaining = queryset.count() - DETAIL_LIMIT
        if remaining > 0:
            self.stdout.write("      ... and %d more" % remaining)

    def _coverage(self, chunk_runs):
        """Name the clauses and paragraphs that fell out, not just the count:
        a coverage gap is only actionable once you know which text is missing.
        """
        if not self.detail:
            return
        for chunk_run in chunk_runs[:DETAIL_LIMIT]:
            stats = chunk_run.stats or {}
            self.stdout.write(
                "      %s: %d unreachable clause(s) %s, %d missing paragraph(s) %s"
                % (chunk_run.extraction_run.document_name,
                   len(stats.get("clauses_unreachable") or []),
                   (stats.get("clauses_unreachable") or [])[:5],
                   len(stats.get("paragraphs_missing") or []),
                   (stats.get("paragraphs_missing") or [])[:5]))


def _document_of(row):
    """The Document behind a Document, ExtractionRun, ChunkRun or ClassificationRun."""
    for attr in ("document", "extraction_run"):
        if hasattr(row, attr):
            return _document_of(getattr(row, attr))
    return row
