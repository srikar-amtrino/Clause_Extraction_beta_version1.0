import hashlib
import json
from unittest import mock

from django.test import SimpleTestCase
from googleapiclient.discovery import build
from googleapiclient.http import HttpMockSequence

from document_pipeline.services import drive_service
from document_pipeline.services.drive_service import (
    DOCX_MIME_TYPE,
    GOOGLE_DOC_MIME_TYPE,
    DriveFile,
    DriveFileError,
    DriveFileRejected,
    DriveIntegrityError,
    download_to_buffer,
    fetch_file_metadata,
    validate_for_parsing,
)

CONTENT = b"PK\x03\x04 pretend docx bytes"


def drive_client(*responses):
    """Drive v3 client whose HTTP layer replays the given (status, body) pairs."""
    http = HttpMockSequence([({"status": str(status)}, body) for status, body in responses])
    return build("drive", "v3", http=http, cache_discovery=False)


def drive_file(**overrides):
    values = dict(id="FILE1", name="contract.docx", mime_type=DOCX_MIME_TYPE, size_bytes=len(CONTENT),
                  md5_checksum=hashlib.md5(CONTENT).hexdigest(), web_view_link="https://drive/FILE1",
                  modified_time="2026-09-01T00:00:00Z")
    values.update(overrides)
    return DriveFile(**values)


class FetchMetadataTests(SimpleTestCase):
    def test_maps_fields(self):
        client = drive_client((200, json.dumps({
            "id": "FILE1", "name": "contract.docx", "mimeType": DOCX_MIME_TYPE, "size": "2048",
            "md5Checksum": "abc", "webViewLink": "https://drive/FILE1", "modifiedTime": "2026-09-01T00:00:00Z",
        })))
        f = fetch_file_metadata(client, "FILE1")
        self.assertEqual((f.name, f.size_bytes, f.md5_checksum), ("contract.docx", 2048, "abc"))

    def test_not_found(self):
        client = drive_client((404, json.dumps({"error": {"code": 404, "message": "File not found"}})))
        with self.assertRaisesMessage(DriveFileError, "not found"):
            fetch_file_metadata(client, "MISSING")


class ValidateTests(SimpleTestCase):
    def test_google_doc_rejected(self):
        with self.assertRaises(DriveFileRejected) as ctx:
            validate_for_parsing(drive_file(mime_type=GOOGLE_DOC_MIME_TYPE), 1024)
        self.assertEqual(ctx.exception.kind, "google_doc")

    def test_other_mime_type_rejected(self):
        with self.assertRaises(DriveFileRejected) as ctx:
            validate_for_parsing(drive_file(mime_type="application/pdf"), 1024)
        self.assertEqual(ctx.exception.kind, "not_docx_mime_type")

    def test_too_large_rejected(self):
        with self.assertRaises(DriveFileRejected) as ctx:
            validate_for_parsing(drive_file(size_bytes=5000), 1024)
        self.assertEqual(ctx.exception.kind, "too_large")

    def test_valid_docx_passes(self):
        validate_for_parsing(drive_file(), 1024)


class DownloadTests(SimpleTestCase):
    @staticmethod
    def track_buffers(created):
        """Record the buffer the service downloads into, so the test can inspect it."""
        real_downloader = drive_service.MediaIoBaseDownload

        def spy(fd, request, **kwargs):
            created.append(fd)
            return real_downloader(fd, request, **kwargs)

        return mock.patch.object(drive_service, "MediaIoBaseDownload", side_effect=spy)

    def test_downloads_into_memory_at_start(self):
        buffer = download_to_buffer(drive_client((200, CONTENT)), drive_file())
        self.assertEqual(buffer.tell(), 0)
        self.assertEqual(buffer.read(), CONTENT)
        buffer.close()

    def test_checksum_mismatch_raises_and_closes_buffer(self):
        created = []
        with self.track_buffers(created):
            with self.assertRaises(DriveIntegrityError):
                download_to_buffer(drive_client((200, CONTENT)), drive_file(md5_checksum="0" * 32))
        self.assertTrue(created[0].closed)

    def test_http_error_closes_buffer(self):
        created = []
        with self.track_buffers(created):
            with self.assertRaises(DriveFileError):
                download_to_buffer(drive_client((403, b"forbidden")), drive_file())
        self.assertTrue(created[0].closed)
