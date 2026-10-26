from django.apps import AppConfig


class DocumentPipelineConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "document_pipeline"
    verbose_name = "Document pipeline"

    def ready(self):
        from . import checks  # noqa: F401  registers the system checks
