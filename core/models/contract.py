import uuid

from django.core.exceptions import ValidationError
from django.db import models

from .contract_type import ContractType
from .ingestion_source import IngestionSource
from .sector import Sector
from .user import User


class Contract(models.Model):
    PIPELINE_STATUS_CHOICES = [
        ('discovered', 'discovered'),
        ('downloaded', 'downloaded'),
        ('extracted', 'extracted'),
        ('chunked', 'chunked'),
        ('classifying', 'classifying'),
        ('classified', 'classified'),
        ('failed', 'failed'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    original_filename = models.CharField(max_length=500)
    contract_type = models.ForeignKey(ContractType, on_delete=models.PROTECT, related_name='contracts')
    sector = models.ForeignKey(Sector, on_delete=models.SET_NULL, null=True, blank=True, related_name='contracts')
    source = models.ForeignKey(IngestionSource, on_delete=models.PROTECT, related_name='contracts')
    source_external_id = models.CharField(max_length=500)
    pipeline_status = models.CharField(max_length=20, choices=PIPELINE_STATUS_CHOICES, default='discovered')
    opened_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='opened_contracts')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'contracts'
        constraints = [
            models.UniqueConstraint(fields=['source', 'source_external_id'], name='unique_contract_source_external_id'),
        ]
        indexes = [
            models.Index(fields=['pipeline_status']),
            models.Index(fields=['contract_type']),
            models.Index(fields=['sector']),
            models.Index(fields=['source']),
            models.Index(fields=['opened_by']),
            models.Index(fields=['source', 'source_external_id']),
        ]
        ordering = ['-created_at']

    def clean(self):
        super().clean()
        if self.contract_type_id and not ContractType.objects.filter(pk=self.contract_type_id).exists():
            raise ValidationError({'contract_type': 'Invalid contract type reference.'})
        if self.sector_id and not Sector.objects.filter(pk=self.sector_id).exists():
            raise ValidationError({'sector': 'Invalid sector reference.'})
        if self.source_id and not IngestionSource.objects.filter(pk=self.source_id).exists():
            raise ValidationError({'source': 'Invalid ingestion source reference.'})
        if self.opened_by_id and not User.objects.filter(pk=self.opened_by_id).exists():
            raise ValidationError({'opened_by': 'Invalid user reference.'})
        if self.pipeline_status not in dict(self.PIPELINE_STATUS_CHOICES):
            raise ValidationError({'pipeline_status': 'Invalid pipeline status.'})

    def __str__(self):
        return self.name
