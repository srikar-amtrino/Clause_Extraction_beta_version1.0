"""Phase 2, Steps 2.1 and 2.2 for one Drive file: stream it into memory, then
extract paragraph records. No database writes happen here."""
import io
import logging
import time
from pathlib import Path

from django.conf import settings

from config.google_drive import build_drive_client
from document_pipeline.parsing.extractor import extract_document
from document_pipeline.parsing.result import REJECTED, ParseResult

from .drive_service import (
    DOCX_MIME_TYPE,
    DriveFileRejected,
    download_to_buffer,
    fetch_file_metadata,
    sha256_of,
    validate_for_parsing,
)

logger = logging.getLogger(__name__)


def _elapsed_ms(started):
    return int((time.perf_counter() - started) * 1000)


def _drive_source(drive_file):
    """Where a result's bytes came from, as persist_parse_result reads it."""
    return {
        "drive_file_id": drive_file.id,
        "name": drive_file.name,
        "file_name": drive_file.name,
        "file_size_bytes": drive_file.size_bytes,
        "drive_web_link": drive_file.web_view_link,
        "mime_type": drive_file.mime_type,
        "md5_checksum": drive_file.md5_checksum,
        "modified_time": drive_file.modified_time,
        "content_sha256": None,
    }


def rejected_result(drive_file, exc):
    """The result for a Drive file refused before download. -> ParseResult

    Shared by the streaming worker and the sync dispatcher, so a refusal is
    recorded the same way whichever of them made it."""
    result = ParseResult(status=REJECTED, document_name=drive_file.name,
                         rejection={"reason": str(exc), "detected_format": exc.kind,
                                    "detected_description": str(exc), "remedy": None})
    result.source = _drive_source(drive_file)
    return result


def stream_and_parse(credentials, file_id, max_file_bytes=None):
    """Download one Drive file into RAM and parse it. -> ParseResult

    Raises DriveFileError when Drive cannot serve the file, since a retry may
    succeed. A file Drive can serve but this pipeline does not parse comes back
    as a `rejected` result, like any other rejection."""
    print('[parse] starting Drive file %s' % file_id, flush=True)
    max_file_bytes = max_file_bytes or settings.PARSE_MAX_FILE_BYTES
    client = build_drive_client(credentials)
    drive_file = fetch_file_metadata(client, file_id)

    try:
        validate_for_parsing(drive_file, max_file_bytes)
    except DriveFileRejected as exc:
        return rejected_result(drive_file, exc)

    source = _drive_source(drive_file)

    started = time.perf_counter()
    buffer = download_to_buffer(client, drive_file)
    download_ms = _elapsed_ms(started)
    try:
        source["content_sha256"] = sha256_of(buffer)
        started = time.perf_counter()
        result = extract_document(buffer, drive_file.name)
        parse_ms = _elapsed_ms(started)
    finally:
        buffer.close()

    result.source = source
    result.timings_ms = {"download": download_ms, "parse": parse_ms}
    print('[parse] completed Drive file %s: %s' % (file_id, result.status), flush=True)
    logger.info("parsed %s: %s, %d paragraph records in %d ms",
                file_id, result.status, len(result.paragraphs), parse_ms)
    return result


def parse_local_file(path, file_id, *, known=None):
    """Parse a .docx already on disk as though Drive had served it. -> ParseResult

    The same file, re-parsed after a parser change, without a Drive round trip
    or Drive credentials. `file_id` is the Drive id the copy came from: it is
    what identifies the document on persist, so a re-parse lands as the next
    attempt of that document rather than creating a second one. `known` carries
    the Drive metadata already on record, so fields this file cannot supply --
    the web link, the Drive modified time -- survive the round trip.
    """
    path = Path(path)
    if not path.is_file():
        raise DriveFileRejected('no file at %s' % path, kind='missing')
    known = known or {}
    source = {
        "drive_file_id": file_id,
        "name": known.get("name") or path.name,
        "file_name": path.name,
        "file_size_bytes": path.stat().st_size,
        "drive_web_link": known.get("drive_web_link") or "",
        "mime_type": known.get("mime_type") or DOCX_MIME_TYPE,
        "md5_checksum": known.get("md5_checksum") or "",
        "modified_time": known.get("modified_time"),
        "content_sha256": None,
    }

    buffer = io.BytesIO(path.read_bytes())
    try:
        source["content_sha256"] = sha256_of(buffer)
        started = time.perf_counter()
        result = extract_document(buffer, source["name"])
        parse_ms = _elapsed_ms(started)
    finally:
        buffer.close()

    result.source = source
    result.timings_ms = {"download": 0, "parse": parse_ms}
    logger.info("parsed local %s as %s: %s, %d paragraph records in %d ms",
                path.name, file_id, result.status, len(result.paragraphs), parse_ms)
    return result
