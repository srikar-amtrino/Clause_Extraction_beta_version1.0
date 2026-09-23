"""Auth helpers — pure, stateless utility functions.

Everything here is imported by ``core.auth_views`` and can be tested without
spinning up a Django request cycle.
"""
import functools
import logging
import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.http import JsonResponse
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


# ---------------------------------------------------------------------------
# View decorator
# ---------------------------------------------------------------------------

def require_auth(view_func):
    """Decorator: require a valid Bearer token on any view.

    On success, injects ``request.user`` (User instance) and
    ``request.user_session`` (UserSession instance) so views
    do not need to re-validate tokens themselves.

    Returns HTTP 401 when the header is absent, the token is
    unknown, or the session has expired.
    """
    @functools.wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        from core.models import UserSession  # local to avoid circular import

        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            return JsonResponse(
                {'detail': 'Authorization header missing or malformed.'}, status=401)

        token = auth_header[len('Bearer '):].strip()
        try:
            session = UserSession.objects.select_related('user').get(token=token)
        except UserSession.DoesNotExist:
            return JsonResponse({'detail': 'Invalid or expired token.'}, status=401)

        if session.expires_at <= timezone.now():
            session.delete()
            return JsonResponse(
                {'detail': 'Session has expired. Please log in again.'}, status=401)

        request.user = session.user
        request.user_session = session
        return view_func(request, *args, **kwargs)

    return _wrapped
