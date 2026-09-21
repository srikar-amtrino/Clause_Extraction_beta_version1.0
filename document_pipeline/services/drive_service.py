"""Step 2.1: stream a single Drive file into memory.

Nothing touches disk. The caller owns the returned buffer and must close it.
"""
import hashlib
import io
import logging
from dataclasses import asdict, dataclass

from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload

logger = logging.getLogger(__name__)

DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document"
METADATA_FIELDS = "id,name,mimeType,size,md5Checksum,webViewLink,modifiedTime"
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
NUM_RETRIES = 3


class DriveFileError(Exception):
    """The file cannot be read from Drive: not found, no access, or a transport
    failure that survived retries. Retrying later may succeed."""


class DriveIntegrityError(DriveFileError):
    """Downloaded bytes do not match the checksum Drive reports."""


class DriveFileRejected(Exception):
    """The file exists but is not something this pipeline parses. Retrying
    will not help. Carries a machine `kind` alongside the human reason."""

    def __init__(self, reason, kind):
        super().__init__(reason)
        self.kind = kind


@dataclass(frozen=True)
class DriveFile:
    id: str
    name: str
    mime_type: str
    size_bytes: int | None
    md5_checksum: str | None
    web_view_link: str | None
    modified_time: str | None

    def to_dict(self):
        return asdict(self)


def _http_error(exc, file_id):
    status = getattr(exc.resp, "status", None)
    if status == 404:
        return DriveFileError("Drive file %s not found, or these credentials cannot see it" % file_id)
    if status == 403:
        return DriveFileError("Access to Drive file %s was refused: %s" % (file_id, exc))
    return DriveFileError("Drive request for %s failed (HTTP %s): %s" % (file_id, status, exc))


def fetch_file_metadata(client, file_id):
    """Metadata for one file, including files on shared drives."""
    try:
        data = (
            client.files()
            .get(fileId=file_id, fields=METADATA_FIELDS, supportsAllDrives=True)
            .execute(num_retries=NUM_RETRIES)
        )
    except HttpError as exc:
        raise _http_error(exc, file_id) from exc

    size = data.get("size")
    return DriveFile(
        id=data["id"],
        name=data.get("name") or "",
        mime_type=data.get("mimeType") or "",
        size_bytes=int(size) if size is not None else None,
        md5_checksum=data.get("md5Checksum"),
        web_view_link=data.get("webViewLink"),
        modified_time=data.get("modifiedTime"),
    )


def validate_for_parsing(drive_file, max_bytes):
    """Refuse, before downloading, anything that cannot or should not be parsed."""
    if drive_file.mime_type == GOOGLE_DOC_MIME_TYPE:
        raise DriveFileRejected(
            "native Google Doc - it has no .docx bytes to download; save it as .docx in Drive",
            "google_doc",
        )
    if drive_file.mime_type != DOCX_MIME_TYPE:
        raise DriveFileRejected(
            "Drive reports type %s, not a Word .docx" % (drive_file.mime_type or "unknown"),
            "not_docx_mime_type",
        )
    if drive_file.size_bytes is not None and drive_file.size_bytes > max_bytes:
        raise DriveFileRejected(
            "file is %d bytes, above the %d byte limit" % (drive_file.size_bytes, max_bytes),
            "too_large",
        )


def download_to_buffer(client, drive_file):
    """Stream the file's bytes into an in-memory buffer positioned at the start.

    Verified against Drive's MD5 checksum when Drive provides one. On any
    failure the buffer is closed before the error propagates."""
    buffer = io.BytesIO()
    try:
        request = client.files().get_media(fileId=drive_file.id, supportsAllDrives=True)
        downloader = MediaIoBaseDownload(buffer, request, chunksize=DOWNLOAD_CHUNK_BYTES)
        done = False
        while not done:
            _progress, done = downloader.next_chunk(num_retries=NUM_RETRIES)

        if drive_file.md5_checksum:
            actual = hashlib.md5(buffer.getbuffer()).hexdigest()
            if actual != drive_file.md5_checksum:
                raise DriveIntegrityError(
                    "Downloaded bytes for %s do not match Drive's checksum (%s != %s)"
                    % (drive_file.id, actual, drive_file.md5_checksum)
                )
        buffer.seek(0)
        logger.info("downloaded %s (%d bytes)", drive_file.id, buffer.getbuffer().nbytes)
        return buffer
    except HttpError as exc:
        buffer.close()
        raise _http_error(exc, drive_file.id) from exc
    except BaseException:
        buffer.close()
        raise


def sha256_of(buffer):
    """Content hash of an in-memory buffer, without moving its position."""
    return hashlib.sha256(buffer.getbuffer()).hexdigest()
