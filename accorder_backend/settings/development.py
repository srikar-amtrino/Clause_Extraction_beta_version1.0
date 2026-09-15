from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / '.env')
SECRET_KEY = 'development-only-change-me'
DEBUG = True
ALLOWED_HOSTS = ['127.0.0.1', 'localhost']

ROOT_URLCONF = 'accorder_backend.urls'

INSTALLED_APPS = [
	'django.contrib.sessions',
	'django.contrib.contenttypes',
	'django.contrib.auth',
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

DATABASES = {
	'default': {
		'ENGINE': 'django.db.backends.sqlite3',
		'NAME': BASE_DIR / 'db.sqlite3',
	},
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
