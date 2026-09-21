import io
import zipfile

from django.test import SimpleTestCase

from document_pipeline.parsing.extractor import extract_document
from document_pipeline.parsing.result import REJECTED

from .docx_builder import make_docx, para


class FormatGateTests(SimpleTestCase):
    def assert_rejected(self, data, kind):
        result = extract_document(data, "upload.docx")
        self.assertEqual(result.status, REJECTED)
        self.assertEqual(result.rejection["detected_format"], kind)
        self.assertTrue(result.rejection["remedy"])
        self.assertEqual(result.paragraphs, [])

    def test_pdf(self):
        self.assert_rejected(b"%PDF-1.7 rest of file", "pdf")

    def test_html_saved_as_docx(self):
        self.assert_rejected(b"<!DOCTYPE html><html><body>Agreement</body></html>", "html")

    def test_legacy_doc(self):
        self.assert_rejected(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64, "legacy_doc_or_encrypted")

    def test_rtf(self):
        self.assert_rejected(b"{\\rtf1\\ansi agreement}", "rtf")

    def test_truncated_zip(self):
        self.assert_rejected(make_docx(para("Text"))[:120], "corrupt")

    def test_zip_without_document_part(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("readme.txt", "not a word file")
        self.assert_rejected(buffer.getvalue(), "zip_not_docx")

    def test_accepts_stream(self):
        result = extract_document(io.BytesIO(make_docx(para("1. Scope"))), "stream.docx")
        self.assertTrue(result.is_usable)
