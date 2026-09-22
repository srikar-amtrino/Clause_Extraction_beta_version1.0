"""Auth views — signup, login, logout, me.

All four views are plain Django functions (no DRF) that match the
``JsonResponse``-based style used throughout ``document_pipeline``.

Error shape:   {"detail": "Human-readable message."}
Success shape: {"token": "...", "user": {id, username, email, role}}
"""
import json
import logging

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .auth_helpers import (
    VALID_ROLES,
    generate_token,
    get_client_ip,
    get_session_expiry,
    hash_password,
    log_auth_event,
    verify_password,
)
from .models import User, UserSession

logger = logging.getLogger('auth')


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _parse_json(request) -> tuple[dict | None, JsonResponse | None]:
    """Return (data, None) on success or (None, error_response) on failure."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, JsonResponse({'detail': 'Invalid JSON body.'}, status=400)
    if not isinstance(data, dict):
        return None, JsonResponse({'detail': 'Request body must be a JSON object.'}, status=400)
    return data, None


def _get_session_from_request(request) -> tuple['UserSession | None', JsonResponse | None]:
    """Extract and validate the Bearer token from the Authorization header.

    Returns ``(session, None)`` on success or ``(None, error_response)`` on
    failure (missing header, bad format, unknown token, expired token).
    """
    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None, JsonResponse({'detail': 'Authorization header missing or malformed.'}, status=401)

    token = auth_header[len('Bearer '):]
    try:
        session = UserSession.objects.select_related('user').get(token=token)
    except UserSession.DoesNotExist:
        return None, JsonResponse({'detail': 'Invalid or expired token.'}, status=401)

    if session.expires_at <= timezone.now():
        session.delete()
        return None, JsonResponse({'detail': 'Session has expired. Please log in again.'}, status=401)

    return session, None


def _user_payload(user: 'User') -> dict:
    """Serialise the User to the shape the frontend expects."""
    return {
        'id': str(user.id),
        'username': user.username,
        'email': user.email,
        'role': user.role,
    }


# ---------------------------------------------------------------------------
# POST /api/auth/signup/
# ---------------------------------------------------------------------------

@csrf_exempt
@require_http_methods(['POST'])
def signup_view(request):
    """Create a new user account and return a session token.

    Required body fields: username, email, password, role.
    Optional body field:  remember_me (bool, default False).
    """
    ip = get_client_ip(request)
    data, err = _parse_json(request)
    if err:
        return err

    # ---- field presence ----
    username = (data.get('username') or '').strip()
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    role = (data.get('role') or '').strip()
    remember_me = bool(data.get('remember_me', False))

    errors = {}
    if not username or len(username) < 2:
        errors['username'] = 'Username must be at least 2 characters.'
    if not email or '@' not in email:
        errors['email'] = 'A valid email address is required.'
    if not password or len(password) < 6:
        errors['password'] = 'Password must be at least 6 characters.'
    if role not in VALID_ROLES:
        errors['role'] = f'Role must be one of: {", ".join(VALID_ROLES)}.'

    if errors:
        return JsonResponse({'detail': 'Validation failed.', 'errors': errors}, status=400)

    # ---- uniqueness ----
    if User.objects.filter(email=email).exists():
        log_auth_event('signup', email=email, ip=ip, success=False, reason='email_taken')
        return JsonResponse({'detail': 'An account with this email already exists.'}, status=409)

    # ---- create user ----
    user = User.objects.create(
        username=username,
        email=email,
        hashed_password=hash_password(password),
        role=role,
    )

    # ---- create session ----
    token = generate_token()
    session = UserSession.objects.create(
        user=user,
        token=token,
        ip_address=ip,
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:1000],
        expires_at=get_session_expiry(remember_me),
    )
    _ = session  # session created; token returned to client

    log_auth_event('signup', user_id=str(user.id), email=email, ip=ip, success=True)

    return JsonResponse({'token': token, 'user': _user_payload(user)}, status=201)


# ---------------------------------------------------------------------------
# POST /api/auth/login/
# ---------------------------------------------------------------------------

@csrf_exempt
@require_http_methods(['POST'])
def login_view(request):
    """Authenticate with email + password and return a new session token.

    Required body fields: email, password.
    Optional body field:  remember_me (bool, default False).
    """
    ip = get_client_ip(request)
    data, err = _parse_json(request)
    if err:
        return err

    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    remember_me = bool(data.get('remember_me', False))

    if not email or not password:
        return JsonResponse({'detail': 'Email and password are required.'}, status=400)

    # ---- look up user ----
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        log_auth_event('login', email=email, ip=ip, success=False, reason='user_not_found')
        # Return the same message as wrong password to avoid user enumeration.
        return JsonResponse({'detail': 'Invalid email or password.'}, status=401)

    if not user.is_active:
        log_auth_event('login', user_id=str(user.id), email=email, ip=ip, success=False, reason='account_inactive')
        return JsonResponse({'detail': 'This account has been deactivated.'}, status=403)

    if not user.hashed_password or not verify_password(password, user.hashed_password):
        log_auth_event('login', user_id=str(user.id), email=email, ip=ip, success=False, reason='bad_password')
        return JsonResponse({'detail': 'Invalid email or password.'}, status=401)

    # ---- record last login ----
    user.last_login = timezone.now()
    user.save(update_fields=['last_login'])

    # ---- create session ----
    token = generate_token()
    UserSession.objects.create(
        user=user,
        token=token,
        ip_address=ip,
        user_agent=request.META.get('HTTP_USER_AGENT', '')[:1000],
        expires_at=get_session_expiry(remember_me),
    )

    log_auth_event('login', user_id=str(user.id), email=email, ip=ip, success=True)

    return JsonResponse({'token': token, 'user': _user_payload(user)}, status=200)


# ---------------------------------------------------------------------------
# POST /api/auth/logout/
# ---------------------------------------------------------------------------

@csrf_exempt
@require_http_methods(['POST'])
def logout_view(request):
    """Invalidate the current session token.

    Header: Authorization: Bearer <token>
    """
    session, err = _get_session_from_request(request)
    if err:
        # A 401 on logout leaks nothing; the client should clear local storage anyway.
        return err

    ip = get_client_ip(request)
    user_id = str(session.user_id)
    email = session.user.email

    session.delete()

    log_auth_event('logout', user_id=user_id, email=email, ip=ip, success=True)

    return JsonResponse({'detail': 'Successfully logged out.'}, status=200)


# ---------------------------------------------------------------------------
# GET /api/auth/me/
# ---------------------------------------------------------------------------

@require_http_methods(['GET'])
def me_view(request):
    """Return the current authenticated user's profile.

    Header: Authorization: Bearer <token>
    """
    session, err = _get_session_from_request(request)
    if err:
        return err

    return JsonResponse({'user': _user_payload(session.user)}, status=200)
