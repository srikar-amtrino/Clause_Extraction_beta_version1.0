"""Auth helpers — pure, stateless utility functions.

Everything here is imported by ``core.auth_views`` and can be tested without
spinning up a Django request cycle.
"""
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

logger = logging.getLogger('auth')

# ---------------------------------------------------------------------------
# Role constants — single source of truth across backend and frontend.
# ---------------------------------------------------------------------------
VALID_ROLES = [
    'Senior Legal Product Analyst',
    'Legal Product Analyst',
    'Senior AI Engineer',
    'AI Engineer',
    'Full Stack Developer',
]

# ---------------------------------------------------------------------------
# Session expiry helpers
# ---------------------------------------------------------------------------
TOKEN_REMEMBER_ME_DAYS = 30    # "Keep me signed in" ticked
TOKEN_SESSION_HOURS = 24       # Default — one working day


def get_session_expiry(remember_me: bool) -> 'datetime':
    """Return an absolute expiry datetime for a new session token.

    Args:
        remember_me: True when the user has checked "Keep me signed in".

    Returns:
        A timezone-aware datetime object.
    """
    if remember_me:
        return timezone.now() + timedelta(days=TOKEN_REMEMBER_ME_DAYS)
    return timezone.now() + timedelta(hours=TOKEN_SESSION_HOURS)


# ---------------------------------------------------------------------------
# Token generation
# ---------------------------------------------------------------------------

def generate_token() -> str:
    """Return a 64-hex (256-bit) cryptographically secure random token."""
    return secrets.token_hex(64)


# ---------------------------------------------------------------------------
# Password hashing — thin wrappers around Django's built-in PBKDF2+SHA256
# ---------------------------------------------------------------------------

def hash_password(raw_password: str) -> str:
    """Hash *raw_password* using Django's default hasher (PBKDF2 + SHA256)."""
    return make_password(raw_password)


def verify_password(raw_password: str, hashed: str) -> bool:
    """Return True if *raw_password* matches *hashed*."""
    return check_password(raw_password, hashed)


# ---------------------------------------------------------------------------
# IP address extraction
# ---------------------------------------------------------------------------

def get_client_ip(request) -> str | None:
    """Extract the real client IP, respecting X-Forwarded-For if present."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


# ---------------------------------------------------------------------------
# Auth logging helpers — structured so log lines are grep/parse friendly.
# ---------------------------------------------------------------------------

def log_auth_event(
    event: str,
    *,
    user_id: str | None = None,
    email: str | None = None,
    ip: str | None = None,
    success: bool = True,
    reason: str | None = None,
) -> None:
    """Write a single structured log line to the ``auth`` logger.

    Example output (auth.log)::

        2026-09-22 10:00:00 INFO auth event=signup user=uuid email=a@b.com ip=1.2.3.4 success=True
    """
    parts = [f'event={event}']
    if user_id:
        parts.append(f'user={user_id}')
    if email:
        parts.append(f'email={email}')
    if ip:
        parts.append(f'ip={ip}')
    parts.append(f'success={success}')
    if reason:
        parts.append(f'reason={reason!r}')

    message = ' '.join(parts)
    if success:
        logger.info(message)
    else:
        logger.warning(message)
