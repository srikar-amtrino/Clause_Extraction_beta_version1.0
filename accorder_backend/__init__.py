try:
    from config.celery import app as celery
    __all__ = ("celery",)
except ImportError:
    pass

