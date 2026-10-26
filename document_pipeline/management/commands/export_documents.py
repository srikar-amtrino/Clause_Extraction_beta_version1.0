"""Rewrite every document's JSON files from what the database holds now.

    python manage.py export_documents
    python manage.py export_documents --document-id <uuid>

Writes extraction.json, classification_input.json and, once a document has
been classified, classification.json to PIPELINE_EXPORT_DIR. Reads only; run
it after classify_documents to see the verdicts as files.
"""
from django.core.management.base import BaseCommand

from document_pipeline.models import Document
from document_pipeline.services import export_service


class Command(BaseCommand):
    help = "Write each document's extraction / classification JSON to PIPELINE_EXPORT_DIR."

    def add_arguments(self, parser):
        parser.add_argument("--document-id", help="export only this document")

    def handle(self, *args, **options):
        documents = Document.objects.filter(deleted_at__isnull=True).order_by("name")
        if options["document_id"]:
            documents = documents.filter(pk=options["document_id"])
        written = 0
        for document in documents:
            if document.current_run is None:
                continue
            paths = export_service.write_exports(document)
            written += 1
            self.stdout.write("%-60s %s" % (document.name[:60], ", ".join(sorted(paths))))
        self.stdout.write(self.style.SUCCESS("%d document(s) written to %s"
                                             % (written, export_service.export_dir())))
