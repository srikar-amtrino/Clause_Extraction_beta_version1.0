import uuid

from django.db import models

# ---------------------------------------------------------------------------
# Role choices — enforced at the API layer too (auth_helpers.VALID_ROLES).
# Store the display label directly so the DB is readable without a join.
# ---------------------------------------------------------------------------
ROLE_CHOICES = [
    ('Senior Legal Product Analyst', 'Senior Legal Product Analyst'),
    ('Legal Product Analyst', 'Legal Product Analyst'),
    ('Senior AI Engineer', 'Senior AI Engineer'),
    ('AI Engineer', 'AI Engineer'),
    ('Full Stack Developer', 'Full Stack Developer'),
]


class User(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, max_length=255)
    # `username` replaces the old `name` field — matches the frontend signup form.
    username = models.CharField(max_length=255)
    hashed_password = models.CharField(max_length=255, null=True, blank=True)
    role = models.CharField(
        max_length=100,
        choices=ROLE_CHOICES,
        default='Legal Product Analyst',
    )
    is_active = models.BooleanField(default=True)
    # Recorded on every successful login so the frontend can display it.
    last_login = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'users'
        ordering = ['email']

    def __str__(self):
        return self.email
