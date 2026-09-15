import hashlib
import json
from unittest import mock

from django.test import SimpleTestCase, override_settings

from document_pipeline.parsing.result import EXTRACTED, REJECTED
from document_pipeline.services.drive_service import DOCX_MIME_TYPE, GOOGLE_DOC_MIME_TYPE
from document_pipeline.services.parse_service import stream_and_parse
from document_pipeline.tests.test_parsing.docx_builder import DECIMAL_NUMBERING, make_docx, para
from document_pipeline.tests.test_services.test_drive_service import drive_client

DOCX = make_docx(para("Payment", num=(1, 0)), para("Customer shall pay within 30 days.", num=(1, 1)),
                 numbering=DECIMAL_NUMBERING)


def metadata(**overrides):
    data = {"id": "FILE1", "name": "contract.docx", "mimeType": DOCX_MIME_TYPE, "size": str(len(DOCX)),
            "md5Checksum": hashlib.md5(DOCX).hexdigest(), "webViewLink": "https://drive/FILE1",
            "modifiedTime": "2026-09-01T00:00:00Z"}
    data.update(overrides)
    return json.dumps(data)


@override_settings(PARSE_MAX_FILE_BYTES=10 * 1024 * 1024)
class StreamAndParseTests(SimpleTestCase):
    def run_with(self, *responses):
        client = drive_client(*responses)
        with mock.patch("document_pipeline.services.parse_service.build_drive_client", return_value=client):
            return stream_and_parse(credentials=None, file_id="FILE1")

    def test_drive_file_to_paragraph_records(self):
        result = self.run_with((200, metadata()), (200, DOCX))
        self.assertEqual(result.status, EXTRACTED)
        self.assertEqual(result.source["drive_file_id"], "FILE1")
        self.assertEqual(result.source["drive_web_link"], "https://drive/FILE1")
        self.assertEqual(result.source["content_sha256"], hashlib.sha256(DOCX).hexdigest())
        self.assertEqual([p.breadcrumbs for p in result.paragraphs], [["1. Payment"], ["1. Payment", "1.1"]])
        self.assertEqual(set(result.timings_ms), {"download", "parse"})

    def test_google_doc_rejected_without_download(self):
        result = self.run_with((200, metadata(mimeType=GOOGLE_DOC_MIME_TYPE)))
        self.assertEqual(result.status, REJECTED)
        self.assertEqual(result.rejection["detected_format"], "google_doc")
        self.assertIsNone(result.source["content_sha256"])
