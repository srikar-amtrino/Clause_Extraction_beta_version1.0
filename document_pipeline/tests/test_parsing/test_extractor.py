import io
import zipfile

from django.test import SimpleTestCase

from document_pipeline.parsing.extractor import extract_document
from document_pipeline.parsing.result import EXTRACTED, FAILED

from .docx_builder import DECIMAL_NUMBERING, make_docx, para, run, table


def by_text(result):
    return {p.text: p for p in result.paragraphs}


class WordNumberingTests(SimpleTestCase):
    def setUp(self):
        self.result = extract_document(make_docx(
            para("Master Services Agreement", outline=0),
            para("This Agreement is made between Supplier and Customer."),
            para("Definitions", num=(1, 0)),
            para("In this Agreement the following terms apply.", num=(1, 1)),
            para("Words in the singular include the plural."),
            para("Payment", num=(1, 0)),
            table([[para("Fee"), para("Amount")]]),
            para("Supplier shall invoice monthly.", num=(1, 1)),
            numbering=DECIMAL_NUMBERING,
        ), "msa.docx")
        self.rows = by_text(self.result)

    def test_status_and_title(self):
        self.assertEqual(self.result.status, EXTRACTED)
        self.assertEqual(self.result.document_title, "Master Services Agreement")

    def test_display_numbers_come_from_numbering_definitions(self):
        numbers = [c["display_number"] for c in self.result.clauses if c["numbering_source"].startswith("word")]
        self.assertEqual(numbers, ["1.", "1.1", "2.", "2.1"])

    def test_breadcrumbs(self):
        self.assertEqual(self.rows["Definitions"].breadcrumbs, ["1. Definitions"])
        self.assertEqual(self.rows["In this Agreement the following terms apply."].breadcrumbs,
                         ["1. Definitions", "1.1"])
        self.assertEqual(self.rows["Supplier shall invoice monthly."].breadcrumbs, ["2. Payment", "2.1"])

    def test_continuation_inherits_clause(self):
        body = self.rows["Words in the singular include the plural."]
        self.assertFalse(body.is_clause_start)
        self.assertEqual(body.clause_id, self.rows["In this Agreement the following terms apply."].clause_id)
        self.assertEqual(body.breadcrumbs, ["1. Definitions", "1.1"])

    def test_table_cells_attach_to_enclosing_clause(self):
        fee = self.rows["Fee"]
        self.assertEqual(fee.bucket, "table")
        self.assertEqual(fee.container, "table")
        self.assertEqual(fee.table_position, {"table": 1, "row": 0, "col": 0})
        self.assertEqual(fee.clause_id, self.rows["Payment"].clause_id)
        self.assertFalse(fee.is_clause_start)

    def test_every_non_empty_paragraph_is_one_record(self):
        texts = [p.text for p in self.result.paragraphs]
        self.assertEqual(len(texts), 9)
        self.assertEqual(texts[0], "Master Services Agreement")
        self.assertEqual([p.paragraph_id for p in self.result.paragraphs][:3], ["P-001", "P-002", "P-003"])
        self.assertEqual([p.sequence_order for p in self.result.paragraphs], list(range(1, 10)))

    def test_front_matter_kept(self):
        preamble = self.rows["This Agreement is made between Supplier and Customer."]
        self.assertEqual(preamble.bucket, "content")
        self.assertEqual(preamble.breadcrumbs, ["FRONT MATTER"])
        self.assertEqual(self.rows["Master Services Agreement"].bucket, "document_title")


class TypedNumberingTests(SimpleTestCase):
    def test_nested_typed_lists(self):
        result = extract_document(make_docx(
            para("1. Services"),
            para("(a) the Supplier provides support;"),
            para("(b) the Supplier provides hosting."),
            para("2. Fees"),
        ), "typed.docx")
        rows = by_text(result)
        self.assertEqual(rows["(a) the Supplier provides support;"].breadcrumbs, ["1. Services", "(a)"])
        self.assertEqual(rows["2. Fees"].breadcrumbs, ["2. Fees"])
        self.assertEqual(result.stats["max_level"], 2)

    def test_run_in_title_labels_step(self):
        result = extract_document(make_docx(
            para("1. Licence"),
            para("1.1 Licence Grant. Supplier grants Customer a non-exclusive licence."),
        ), "runin.docx")
        rows = by_text(result)
        self.assertEqual(rows["1.1 Licence Grant. Supplier grants Customer a non-exclusive licence."].breadcrumbs,
                         ["1. Licence", "1.1 Licence Grant"])

    def test_inline_clauses_split_into_separate_records(self):
        text = ("1.1 Scope. The Supplier shall provide the services described. "
                "1.2 Fees. The Customer shall pay the fees within thirty days.")
        result = extract_document(make_docx(para("1. Terms"), para(text)), "inline.docx")
        pieces = [p for p in result.paragraphs if p.source_paragraph_index == 1]
        self.assertEqual([p.segment_index for p in pieces], [0, 1])
        self.assertEqual(" ".join(p.text for p in pieces), text)
        self.assertEqual(result.stats["inline_splits"], 1)


class TextTests(SimpleTestCase):
    def test_tracked_changes_hidden_and_moved_text(self):
        body = (run("Keep ")
                + "<w:ins><w:r><w:t xml:space=\"preserve\">added </w:t></w:r></w:ins>"
                + "<w:del><w:r><w:delText>removed </w:delText></w:r></w:del>"
                + run("secret ", hidden=True)
                + "<w:moveFrom><w:r><w:t>old </w:t></w:r></w:moveFrom>"
                + "<w:moveTo><w:r><w:t>moved</w:t></w:r></w:moveTo>")
        result = extract_document(make_docx(para("1. Scope"), para(body)), "tracked.docx")
        self.assertEqual(result.paragraphs[1].text, "Keep added moved")


class PageTests(SimpleTestCase):
    def pages(self, *blocks):
        result = extract_document(make_docx(*blocks), "pages.docx")
        self.assertTrue(result.is_usable, result.rejection)
        return result, [p.page_number for p in result.paragraphs]

    def test_explicit_breaks(self):
        result, pages = self.pages(
            para("1. First page"),
            para(run("Second page", before='<w:br w:type="page"/>')),
            para(run("Still second", after='<w:br w:type="page"/>'), run("then third")),
            para("Third page"),
            para("Fourth page", page_break_before=True, section_break="nextPage"),
            para("Fifth page"),
            para("Same section page", section_break="continuous"),
            para("Still fifth"),
        )
        self.assertEqual(pages, [1, 2, 2, 3, 4, 5, 5, 5])
        self.assertEqual(result.stats["page_source"], "explicit")
        self.assertEqual(result.stats["page_count"], 5)

    def test_rendered_marks_win_and_are_not_double_counted(self):
        lrpb = "<w:lastRenderedPageBreak/>"
        result, pages = self.pages(
            para("1. First page"),
            # Word wrote both a hard break and a render mark for the same page turn
            para(run("Second page", before='<w:br w:type="page"/>' + lrpb)),
            para("Still second"),
        )
        self.assertEqual(pages, [1, 2, 2])
        self.assertEqual(result.stats["page_source"], "rendered")

    def test_table_row_spanning_pages_counts_once(self):
        lrpb = "<w:lastRenderedPageBreak/>"
        _result, pages = self.pages(
            para("1. First page"),
            table([[para(run("Left", before=lrpb)), para(run("Right", before=lrpb))]]),
            para("After table"),
        )
        self.assertEqual(pages, [1, 2, 2, 2])


class FailureTests(SimpleTestCase):
    def test_missing_body_fails_with_reason(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as z:
            z.writestr("word/document.xml",
                       '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>')
        with self.assertLogs("document_pipeline.parsing.extractor", level="ERROR"):
            result = extract_document(buffer.getvalue(), "nobody.docx")
        self.assertEqual(result.status, FAILED)
        self.assertIn("no <w:body>", result.rejection["reason"])
