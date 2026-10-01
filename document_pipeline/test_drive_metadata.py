import json
from unittest.mock import patch

from django.test import TestCase

from document_pipeline.models import Document
from document_pipeline.services.ingestion_service import (
    google_drive_source,
    sync_drive_files,
)


class DriveMetadataTests(TestCase):
    def test_folder_files_endpoint_accepts_metadata_with_post(self):
        session = self.client.session
        session['google_drive_credentials'] = 'credentials'
        session.save()
        payload = {
            'folder_ids': ['drive-folder-id'],
            'agreement_type': 'Master Services Agreement (MSA)',
            'sectorial_category': 'Information Technology & Software',
        }

        with patch('document_pipeline.views.credentials_from_json'), \
                patch('document_pipeline.views._build_folder_snapshot', return_value=[]), \
                patch('document_pipeline.views._sync_and_queue',
                      return_value=(None, None, [], 'refreshed')) as sync_and_queue, \
                patch('document_pipeline.views._changes_payload', return_value={}), \
                patch('document_pipeline.views._ingestion_payload', return_value={}), \
                patch('document_pipeline.pipeline_logger.log_folder_selected'):
            response = self.client.post(
                '/api/google-drive/files/',
                data=json.dumps(payload),
                content_type='application/json',
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(sync_and_queue.call_args.args[2:], (
            ['drive-folder-id'],
            'Master Services Agreement (MSA)',
            'Information Technology & Software',
        ))
        saved_session = self.client.session
        self.assertEqual(saved_session['google_drive_agreement_type'], payload['agreement_type'])
        self.assertEqual(saved_session['google_drive_sectorial_category'], payload['sectorial_category'])
        self.assertEqual(self.client.get('/api/google-drive/files/').status_code, 405)

    def test_picker_metadata_updates_unchanged_documents(self):
        source = google_drive_source()
        files = {
            'drive-file-id': {
                'id': 'drive-file-id',
                'name': 'agreement.docx',
                'mimeType': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'parent_id': 'drive-folder-id',
            },
        }
        patches = (
            patch('document_pipeline.services.ingestion_service.log_drive_discovered'),
            patch('document_pipeline.pipeline_logger.log_deduplication_decision'),
            patch('document_pipeline.pipeline_logger.log_deduplication_summary'),
        )
        with patches[0], patches[1], patches[2]:
            sync_drive_files(files, ingestion_source=source,
                             folder_ids=['drive-folder-id'])
            outcome = sync_drive_files(
                files,
                ingestion_source=source,
                folder_ids=['drive-folder-id'],
                agreement_type='Master Services Agreement (MSA)',
                sectorial_category='Information Technology & Software',
            )

        document = Document.objects.get(source_external_id='drive-file-id')
        self.assertEqual(outcome.unchanged, 1)
        self.assertEqual(document.agreement_type, 'Master Services Agreement (MSA)')
        self.assertEqual(document.sectorial_category, 'Information Technology & Software')