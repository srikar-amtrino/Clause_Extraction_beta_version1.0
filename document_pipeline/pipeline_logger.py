"""End-to-end pipeline storytelling logger.

Writes rich, structured, highly readable narrative logs to logs/pipeline_flow.log
covering every phase:
1. Google Drive connect & OAuth
2. Folder selection & Drive file snapshots
3. File deduplication (explicit matching & duplicate prevention)
4. Celery worker task transitions
5. Parsing & Database schema updates (documents, extraction_runs, extracted_paragraphs)
6. Chunking & Database schema updates (chunk_runs, chunks)
7. Complete Bedrock Claude API call (prompts, tokens, raw responses, classifications)
8. Finalization & Review Workspace materialization (document_paragraph_records)
"""
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "pipeline_flow.log"

_lock = threading.Lock()


def _write_entry(banner_title: str, lines: list[str]):
    """Format and append a narrative story block to pipeline_flow.log."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    border = "=" * 80
    header = f"[{timestamp}] {banner_title}"

    block = [
        "",
        border,
        header,
        border,
    ]
    block.extend(lines)
    block.append(border)
    block.append("")

    text = "\n".join(block) + "\n"

    with _lock:
        try:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(text)
        except Exception as e:
            print(f"[pipeline_logger] Error writing to {LOG_FILE}: {e}", flush=True)

    # Also log to standard python logger
    logger = logging.getLogger("pipeline_flow")
    logger.info("%s\n%s", header, "\n".join(lines))


# ---------------------------------------------------------------------------
# Phase 1: Google Drive Connection & OAuth
# ---------------------------------------------------------------------------

def log_drive_connected(user_info: dict, session_key: str = None):
    lines = [
        "Status: SUCCESS (OAuth 2.0 Token Exchange Complete)",
        f"Session Key: {session_key or 'N/A'}",
        "Connected Google Account:",
        f"  - Email:   {user_info.get('email', 'Unknown')}",
        f"  - Name:    {user_info.get('name', 'Unknown')}",
        f"  - User ID: {user_info.get('id', 'Unknown')}",
        "Storage: Google Drive OAuth credentials stored in Django session.",
    ]
    _write_entry("PHASE 1: GOOGLE DRIVE CONNECTED", lines)


# ---------------------------------------------------------------------------
# Phase 2: Folder Selection & File Discovery
# ---------------------------------------------------------------------------

def log_folder_selected(folder_ids: list, folders: list, total_files: int):
    lines = [
        f"Selected Folder ID(s): {', '.join(folder_ids)}",
        f"Total Drive Files Discovered: {total_files}",
        "Folder Tree Structure:",
    ]
    for f in folders:
        lines.append(f"  📁 Folder: '{f.get('name')}' (ID: {f.get('id')})")
        files = f.get('files', [])
        lines.append(f"     Found {len(files)} file(s) in this folder:")
        for doc in files:
            lines.append(f"       - '{doc.get('name')}' (Drive ID: {doc.get('id')}, Size: {doc.get('size', 'N/A')} bytes, Mime: {doc.get('mimeType')})")
    _write_entry("PHASE 2: FOLDER SELECTION & DRIVE DISCOVERY", lines)


# ---------------------------------------------------------------------------
# Phase 3: Deduplication & Reconciliation
# ---------------------------------------------------------------------------

def log_deduplication_summary(created: list, updated: list, renamed: list,
                              restored: list, deleted: list, unchanged: int):
    lines = [
        "Reconciliation & Deduplication Summary:",
        f"  - NEW (Created):   {len(created)} document(s)",
        f"  - UPDATED (Mtime): {len(updated)} document(s)",
        f"  - RENAMED:         {len(renamed)} document(s)",
        f"  - RESTORED:        {len(restored)} document(s)",
        f"  - DELETED:         {len(deleted)} document(s)",
        f"  - UNCHANGED:       {unchanged} document(s) (Skipped download & parsing)",
    ]
    if created:
        lines.append("\n  Created Documents:")
        for d in created:
            lines.append(f"    + Document ID: {d.id} | Name: '{d.name}' | Drive ID: {d.source_external_id}")
    if updated:
        lines.append("\n  Updated Documents:")
        for d in updated:
            lines.append(f"    * Document ID: {d.id} | Name: '{d.name}' | Modified: {d.source_modified_time}")
    _write_entry("PHASE 3: DRIVE DEDUPLICATION & RECONCILIATION", lines)


def log_deduplication_decision(action: str, name: str, file_id: str,
                               parent_id: str, document_id: str = None, details: str = ""):
    lines = [
        f"File Name:        '{name}'",
        f"Drive File ID:    {file_id}",
        f"Parent Folder ID: {parent_id}",
        f"Database Doc ID:  {document_id or 'None'}",
        f"Action:           {action}",
        f"Reason:           {details}",
    ]
    _write_entry(f"DEDUPLICATION: {action.upper()} -> '{name}'", lines)


# ---------------------------------------------------------------------------
# Phase 4: Celery Task Pipeline
# ---------------------------------------------------------------------------

def log_celery_task_dispatched(task_name: str, task_id: str, queue: str, document_id: str):
    lines = [
        f"Task Name:   {task_name}",
        f"Task ID:     {task_id}",
        f"Queue:       {queue}",
        f"Document ID: {document_id}",
        "Status:      DISPATCHED TO BROKER",
    ]
    _write_entry(f"CELERY: TASK DISPATCHED -> {task_name}", lines)


def log_celery_task_started(task_name: str, task_id: str, document_id: str):
    lines = [
        f"Task Name:   {task_name}",
        f"Task ID:     {task_id}",
        f"Document ID: {document_id}",
        "Status:      EXECUTION STARTED BY WORKER",
    ]
    _write_entry(f"CELERY: TASK STARTED -> {task_name}", lines)


# ---------------------------------------------------------------------------
# Phase 5: XML / Document Parsing & Database Schema Updates
# ---------------------------------------------------------------------------

def log_parsing_result(document, extraction_run, paragraphs_count: int, clauses_count: int):
    lines = [
        f"Document Name:    '{document.name}'",
        f"Document ID:      {document.id}",
        f"Extraction Run:   {extraction_run.id} (Build: {extraction_run.parser_build})",
        f"Page Count:       {extraction_run.page_count}",
        f"Paragraphs Parsed: {paragraphs_count}",
        f"Clauses Parsed:    {clauses_count}",
        f"Extraction Status: {extraction_run.status}",
        "",
        "DATABASE SCHEMA & UPDATES APPLIED:",
        "--------------------------------------------------------------------",
        "1. Table 'documents':",
        f"   - extraction_status: '{document.extraction_status}'",
        f"   - last_extracted_at: '{document.last_extracted_at}'",
        "2. Table 'extraction_runs':",
        f"   - id:                  UUID '{extraction_run.id}'",
        f"   - document_id:         UUID '{document.id}'",
        f"   - is_current:          True",
        f"   - status:              '{extraction_run.status}'",
        f"   - page_count:          {extraction_run.page_count}",
        f"   - clause_count:        {clauses_count}",
        f"   - paragraph_count:     {paragraphs_count}",
        "3. Table 'extracted_paragraphs':",
        f"   - Inserted {paragraphs_count} rows (Fields: id, document_id, extraction_run_id, paragraph_id, original_text, breadcrumb, source_page)",
    ]
    _write_entry(f"PHASE 4: PARSING COMPLETE & DB UPDATED -> '{document.name}'", lines)


# ---------------------------------------------------------------------------
# Phase 6: Chunking & Database Schema Updates
# ---------------------------------------------------------------------------

def log_chunking_result(document_id: str, chunk_run, macro_count: int, micro_count: int):
    lines = [
        f"Document ID:    {document_id}",
        f"Chunk Run ID:   {chunk_run.id}",
        f"Chunker Version: {chunk_run.chunker_version}",
        f"Macro Chunks:   {macro_count} (Parent sections)",
        f"Micro Chunks:   {micro_count} (Leaf clauses for classification)",
        "",
        "DATABASE SCHEMA & UPDATES APPLIED:",
        "--------------------------------------------------------------------",
        "1. Table 'chunk_runs':",
        f"   - id:                UUID '{chunk_run.id}'",
        f"   - extraction_run_id: UUID '{chunk_run.extraction_run_id}'",
        f"   - is_current:        True",
        f"   - macro_count:       {macro_count}",
        f"   - micro_count:       {micro_count}",
        "2. Table 'chunks':",
        f"   - Inserted {macro_count + micro_count} rows (Fields: id, chunk_run_id, kind, text, breadcrumb, order_index, token_estimate)",
    ]
    _write_entry(f"PHASE 5: CHUNKING COMPLETE & DB UPDATED -> Doc {document_id}", lines)


# ---------------------------------------------------------------------------
# Phase 7: Bedrock Claude API Call & Complete Content
# ---------------------------------------------------------------------------

def log_claude_call_start(run_id: str, batch_index: int, total_items: int, model_id: str):
    lines = [
        f"Classification Run ID: {run_id}",
        f"Batch Index:          {batch_index}",
        f"Batch Size:           {total_items} micro-chunk(s)",
        f"Bedrock Model:        {model_id}",
        "Status:               SENDING REQUEST TO AWS BEDROCK...",
    ]
    _write_entry(f"PHASE 6: CLAUDE CALL INITIATED (Batch {batch_index})", lines)


def log_claude_call_details(run_id: str, batch_index: int, system_prompt: str,
                            batch_prompt: str, raw_response: str,
                            input_tokens: int, output_tokens: int,
                            latency_ms: int, parsed_results: list):
    lines = [
        f"Classification Run ID: {run_id}",
        f"Batch Index:          {batch_index}",
        f"Latency:              {latency_ms} ms",
        f"Tokens:               Input: {input_tokens} | Output: {output_tokens}",
        "",
        ">>> 1. CLAUDE SYSTEM PROMPT:",
        system_prompt.strip()[:600] + ("\n... [system prompt truncated for brevity] ...\n" if len(system_prompt) > 600 else ""),
        "",
        ">>> 2. CLAUDE INPUT BATCH PROMPT (Exact text sent):",
        batch_prompt.strip(),
        "",
        ">>> 3. RAW CLAUDE BEDROCK RESPONSE:",
        raw_response.strip(),
        "",
        f">>> 4. PARSED CLASSIFICATION OUTCOMES ({len(parsed_results)} items):",
    ]
    for r in parsed_results:
        lines.append(
            f"  - Paragraph [{r.get('paragraph_id')}]: Label='{r.get('label')}', "
            f"Type='{r.get('canonical_type')}', Confidence={r.get('confidence')}, "
            f"Issues={r.get('issues', [])}"
        )

    _write_entry(f"PHASE 6: CLAUDE CALL COMPLETED (Batch {batch_index})", lines)


def log_classification_saved(run_id: str, document_id: str, stats: dict):
    lines = [
        f"Classification Run ID: {run_id}",
        f"Document ID:           {document_id}",
        f"Status:                {stats.get('status', 'SUCCEEDED')}",
        f"Micro Chunks:          {stats.get('micro_count')}",
        f"Classified:            {stats.get('classified_count')}",
        f"Needs Review:          {stats.get('review_count')}",
        f"Total Bedrock Calls:   {stats.get('call_count')}",
        f"Total Input Tokens:    {stats.get('input_tokens')}",
        f"Total Output Tokens:   {stats.get('output_tokens')}",
        "",
        "DATABASE SCHEMA & UPDATES APPLIED:",
        "--------------------------------------------------------------------",
        "1. Table 'classification_runs':",
        f"   - id:                 UUID '{run_id}'",
        f"   - status:             '{stats.get('status')}'",
        f"   - is_current:         True",
        f"   - classified_count:   {stats.get('classified_count')}",
        f"   - review_count:       {stats.get('review_count')}",
        "2. Table 'classifications':",
        f"   - Recorded {stats.get('classified_count')} rows with (paragraph_id, label, canonical_type, confidence, issues)",
        "3. Table 'classification_calls':",
        f"   - Recorded {stats.get('call_count')} Bedrock API calls with prompt tokens, completion tokens, latency, cost",
    ]
    _write_entry(f"PHASE 6: CLASSIFICATION SAVED TO DB -> Doc {document_id}", lines)


# ---------------------------------------------------------------------------
# Phase 8: Finalization & Review Workspace Materialization
# ---------------------------------------------------------------------------

def log_finalization_complete(document_id: str, paragraph_records_count: int,
                              flagged_for_review: int):
    lines = [
        f"Document ID:               {document_id}",
        f"Review Status:             'needs_review' (Pipeline paused before embedding)",
        f"Materialized Records:      {paragraph_records_count} paragraphs in Postgres",
        f"Flagged for Human Review:  {flagged_for_review} paragraphs",
        "",
        "DATABASE SCHEMA & UPDATES APPLIED:",
        "--------------------------------------------------------------------",
        "1. Table 'documents':",
        f"   - review_status:           'needs_review'",
        "2. Table 'document_paragraph_records':",
        f"   - Materialized {paragraph_records_count} rows for the Review Workspace",
        "     (Fields: paragraph_id, original_text, reviewed_text, label, canonical_type, is_reviewed=False, is_modified=False)",
        "3. Table 'document_activity_logs':",
        f"   - Inserted activity entry under phase 'data_classification' (action: 'needs_review')",
        "",
        "🎉 DOCUMENT IS NOW LIVE IN THE REVIEW WORKSPACE READY FOR ANALYSTS!",
    ]
    _write_entry(f"PHASE 7: REVIEW WORKSPACE FINALIZED -> Doc {document_id}", lines)
