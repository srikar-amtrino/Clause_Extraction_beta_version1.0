import os
from dotenv import load_dotenv
from urllib.parse import urlparse, parse_qsl

load_dotenv()

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
SECRET_KEY = 'development-only-change-me'
DEBUG = True
ALLOWED_HOSTS = ['127.0.0.1', 'localhost']

ROOT_URLCONF = 'accorder_backend.urls'

INSTALLED_APPS = [
    'django.contrib.sessions',
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'core',
    'document_pipeline',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
]

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': []},
}]

tmpPostgres = urlparse(os.getenv("DATABASE_URL"))

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': tmpPostgres.path.replace('/', ''),
        'USER': tmpPostgres.username,
        'PASSWORD': tmpPostgres.password,
        'HOST': tmpPostgres.hostname,
        'PORT': 5432,
        'OPTIONS': dict(parse_qsl(tmpPostgres.query)),
    }
}
DATABASE_URL='postgresql://neondb_owner:npg_lRgV4FWfL5cz@ep-raspy-night-aecst0u0-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
