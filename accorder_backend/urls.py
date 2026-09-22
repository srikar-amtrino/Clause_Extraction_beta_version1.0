from django.urls import include, path

urlpatterns = [
    path("api/", include("document_pipeline.urls")),
    path("api/", include("core.urls")),
]
