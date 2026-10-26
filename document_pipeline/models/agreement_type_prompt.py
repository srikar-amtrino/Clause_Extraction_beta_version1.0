"""The stored classification system prompt for an agreement type."""
from django.db import models


class AgreementTypePrompt(models.Model):
    agreement_type = models.OneToOneField(
        'document_pipeline.AgreementType',
        on_delete=models.CASCADE,
        related_name='classification_prompt',
    )
    prompt = models.TextField()

    class Meta:
        db_table = 'agreement_type_prompts'

    def __str__(self):
        return 'Classification prompt for %s' % self.agreement_type
