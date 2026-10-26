"""Is this actually a .docx?

File names and Drive MIME types lie. A contract template is often HTML or a
1997 binary .doc with the wrong name, and Word opens it happily. Nothing is
converted here: a file that is not a real .docx is rejected with a specific
reason, identified from its leading bytes.
"""
import zipfile

OOXML_MAGIC = b"PK\x03\x04"

# Uncompressed size above which a part is refused (zip bomb guard).
MAX_PART_BYTES = 200 * 1024 * 1024

DOCUMENT_PART = "word/document.xml"
STYLES_PART = "word/styles.xml"
NUMBERING_PART = "word/numbering.xml"

REMEDIES = {
    "legacy_doc_or_encrypted": "open in Word and Save As .docx, or get an unlocked copy",
    "encrypted": "get a copy without password protection",
    "html": "this is a web page, not a Word file - open in Word and Save As .docx",
    "pdf": "request the original Word file",
    "rtf": "open in Word and Save As .docx",
    "word2003xml": "open in Word and Save As .docx",
    "xml": "request the original Word file",
    "corrupt": "file is damaged - request a fresh copy",
    "zip_not_docx": "not a Word document - request the correct file",
    "too_large": "file expands beyond the safe size limit - send to engineering",
    "unknown": "unrecognised file type - request the correct .docx",
}


class NotADocxError(ValueError):
    """Not a valid Word 2007+ .docx. Carries a machine kind and a human description."""

    def __init__(self, message, kind="unknown", human=None):
        super().__init__(message)
        self.kind = kind
        self.human = human or message

    @property
    def remedy(self):
        return REMEDIES.get(self.kind, "review this file manually")


def describe_head(head):
    """Identify a file from its leading bytes. -> (kind, description)"""
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return ("legacy_doc_or_encrypted",
                "legacy Word 97-2003 .doc, or an encrypted / password-protected .docx")
    if head[:5] == b"%PDF-":
        return ("pdf", "PDF file")
    if head.startswith(b"{\\rt"):
        return ("rtf", "RTF file")

    low = head.lstrip().lower()
    if low.startswith(b"<htm") or low.startswith(b"<!doctype html") or b"<html" in low[:400]:
        return ("html", "HTML saved with a Word extension")
    if low.startswith(b"<?xml"):
        if b"wordDocument" in head:
            return ("word2003xml", "Word 2003 XML format, not .docx")
        return ("xml", "generic XML file")
    if head.startswith(OOXML_MAGIC):
        return ("zip_not_docx", "zip archive that is not a Word document")
    return ("unknown", "unrecognised file (starts with %s)" % head[:4].hex())


def load_parts(stream):
    """Return the document, styles and numbering XML from a binary stream.

    styles.xml and numbering.xml are optional. A document with neither is still
    extractable through the typed-numbering path."""
    stream.seek(0)
    head = stream.read(1024)
    stream.seek(0)
    if not head.startswith(OOXML_MAGIC):
        kind, human = describe_head(head)
        raise NotADocxError("not a .docx - detected %s" % human, kind, human)

    try:
        with zipfile.ZipFile(stream) as z:
            infos = {i.filename: i for i in z.infolist()}
            if DOCUMENT_PART not in infos:
                if any(n.startswith("EncryptedPackage") for n in infos):
                    raise NotADocxError("file is encrypted / password-protected", "encrypted",
                                        "encrypted / password-protected Office file")
                raise NotADocxError("zip archive contains no word/document.xml", "zip_not_docx",
                                    "zip archive that is not a Word document")

            def read(name):
                info = infos.get(name)
                if info is None:
                    return None
                if info.file_size > MAX_PART_BYTES:
                    raise NotADocxError("%s expands to %d bytes" % (name, info.file_size),
                                        "too_large", "part too large to parse safely")
                return z.read(info)

            return {
                "document": read(DOCUMENT_PART),
                "styles": read(STYLES_PART),
                "numbering": read(NUMBERING_PART),
            }
    except zipfile.BadZipFile as exc:
        raise NotADocxError("file is corrupt or unreadable as a zip archive", "corrupt",
                            "corrupt or truncated file") from exc
