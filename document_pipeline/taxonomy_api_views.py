"""Read and maintain canonical taxonomy entries."""
import json

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.utils.text import slugify
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods

from core.auth_helpers import require_auth
from document_pipeline.classification.taxonomy import normalize
from document_pipeline.models import (
    AgreementType,
    CanonicalType,
    CanonicalTypeAlias,
    CanonicalTypeExclusion,
    SectorType,
)


def _json_body(request):
    try:
        payload = json.loads(request.body or b'{}')
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, JsonResponse({'detail': 'Request body must be valid JSON.'}, status=400)
    if not isinstance(payload, dict):
        return None, JsonResponse({'detail': 'Request body must be a JSON object.'}, status=400)
    return payload, None


def _type_data(canonical_type):
    aliases = list(canonical_type.alias_rows.all())
    exclusions = list(canonical_type.exclusions.select_related('to_type').all())
    agreement = canonical_type.agreement_type
    return {
        'id': str(canonical_type.pk),
        'version': canonical_type.version,
        'applies_to': canonical_type.applies_to,
        'number': canonical_type.number,
        'key': canonical_type.key,
        'name': canonical_type.name,
        'definition': canonical_type.definition,
        'aliases': [row.alias for row in aliases],
        'alias_details': [{
            'id': str(row.pk),
            'alias': row.alias,
            'match_key': row.match_key,
            'is_literal': row.is_literal,
            'note': row.note,
            'position': row.position,
        } for row in aliases],
        'excludes': [{
            'id': str(row.to_type_id),
            'key': row.to_type.key,
            'name': row.to_type.name,
            'note': row.note,
        } for row in exclusions],
        'agreement_type': (
            {'id': agreement.pk, 'name': agreement.name} if agreement else None
        ),
        'agreement_type_id': canonical_type.agreement_type_id,
        'is_active': canonical_type.is_active,
        'sort_order': canonical_type.sort_order,
        'created_at': canonical_type.created_at.isoformat(),
    }


@require_GET
def canonical_type_list(request):
    rows = (
        CanonicalType.objects
        .select_related('agreement_type')
        .prefetch_related('alias_rows', 'exclusions__to_type')
        .all()
    )
    return JsonResponse({
        'canonical_types': [_type_data(row) for row in rows],
        'agreement_types': [
            {'id': row.pk, 'name': row.name} for row in AgreementType.objects.all()
        ],
        'sector_types': [
            {'id': row.pk, 'name': row.name} for row in SectorType.objects.all()
        ],
    }, json_dumps_params={'ensure_ascii': False})


@require_GET
def agreement_type_list(request):
    """Agreement types that have a taxonomy in canonical_types, for the
    folder-metadata dropdown."""
    rows = AgreementType.objects.filter(canonical_types__isnull=False).distinct()
    return JsonResponse({
        'agreement_types': [{'id': row.pk, 'name': row.name} for row in rows],
    }, json_dumps_params={'ensure_ascii': False})


def _validate_aliases(value):
    if not isinstance(value, list):
        return None, 'aliases must be a list of strings.'
    aliases = []
    seen = set()
    for value_item in value:
        if not isinstance(value_item, str) or not value_item.strip():
            return None, 'Each alias must be a non-empty string.'
        key = normalize(value_item)
        if key in seen:
            return None, 'aliases must not contain duplicates.'
        seen.add(key)
        aliases.append(value_item.strip())
    return aliases, None


def _validate_exclusions(value, version, agreement_type_id, current_type=None):
    if not isinstance(value, list):
        return None, 'excludes must be a list.'
    exclusions = []
    seen = set()
    scope = CanonicalType.objects.filter(
        version=version,
        agreement_type_id=agreement_type_id,
    )
    for item in value:
        if isinstance(item, str):
            reference, note = item, ''
        elif isinstance(item, dict):
            reference, note = item.get('key') or item.get('id'), item.get('note', '')
        else:
            return None, 'Each exclusion must be a key or an object with key and note.'
        if not isinstance(reference, (str, int)) or not str(reference).strip():
            return None, 'Each exclusion must identify a canonical type by key or id.'
        if not isinstance(note, str) or len(note) > 255:
            return None, 'Each exclusion note must be a string of at most 255 characters.'
        target = scope.filter(key=str(reference)).first()
        if target is None:
            try:
                target = scope.filter(pk=reference).first()
            except (ValidationError, ValueError, TypeError):
                target = None
        if target is None:
            return None, 'Exclusion %r was not found in taxonomy %s.' % (reference, version)
        if current_type is not None and target.pk == current_type.pk:
            return None, 'A canonical type cannot exclude itself.'
        if target.pk in seen:
            return None, 'excludes must not contain duplicates.'
        seen.add(target.pk)
        exclusions.append((target, note))
    return exclusions, None


def _prepare_values(payload, current_type=None):
    allowed_fields = {
        'agreement_type_id', 'applies_to', 'number', 'key', 'name',
        'definition', 'aliases', 'excludes', 'is_active',
    }
    if current_type is None:
        allowed_fields.add('version')
    unexpected = set(payload) - allowed_fields
    if unexpected:
        return None, 'Unsupported field(s): %s.' % ', '.join(sorted(unexpected))

    values = {}
    for field in ('applies_to', 'number', 'key', 'name', 'definition'):
        if field in payload:
            values[field] = payload[field]
        elif current_type is not None:
            values[field] = getattr(current_type, field)
        else:
            return None, '%s is required.' % field

    if values['applies_to'] not in (CanonicalType.CLAUSE, CanonicalType.NON_CLAUSE):
        return None, 'applies_to must be "clause" or "non_clause".'
    if (
        not isinstance(values['number'], int)
        or isinstance(values['number'], bool)
        or values['number'] < 1
    ):
        return None, 'number must be a positive integer.'
    if not isinstance(values['key'], str) or not values['key'].strip():
        return None, 'key must be a non-empty slug.'
    values['key'] = values['key'].strip()
    if slugify(values['key']) != values['key'] or len(values['key']) > 64:
        return None, 'key must be a slug of at most 64 characters.'
    if not isinstance(values['name'], str) or not values['name'].strip():
        return None, 'name must be a non-empty string.'
    values['name'] = values['name'].strip()
    if len(values['name']) > 128:
        return None, 'name must be at most 128 characters.'
    if not isinstance(values['definition'], str) or not values['definition'].strip():
        return None, 'definition must be a non-empty string.'

    version = payload.get(
        'version',
        current_type.version if current_type is not None else 'v1',
    )
    if not isinstance(version, str) or not version.strip() or len(version) > 16:
        return None, 'version must be a non-empty string of at most 16 characters.'
    values['version'] = version.strip()

    agreement_type_id = payload.get(
        'agreement_type_id',
        current_type.agreement_type_id if current_type is not None else None,
    )
    if agreement_type_id is None:
        return None, 'agreement_type_id is required.'
    try:
        agreement_type = AgreementType.objects.filter(pk=agreement_type_id).first()
    except (ValidationError, ValueError, TypeError):
        agreement_type = None
    if agreement_type is None:
        return None, 'agreement_type_id does not match an agreement type.'
    values['agreement_type'] = agreement_type

    if 'aliases' in payload:
        aliases, error = _validate_aliases(payload['aliases'])
        if error:
            return None, error
        values['aliases'] = [{
            'alias': alias,
            'match_key': normalize(alias),
            'is_literal': True,
            'note': '',
        } for alias in aliases]
    elif current_type is not None:
        values['aliases'] = [{
            'alias': row.alias,
            'match_key': row.match_key,
            'is_literal': row.is_literal,
            'note': row.note,
        } for row in current_type.alias_rows.all()]
    else:
        values['aliases'] = []

    if 'excludes' in payload:
        exclusions = payload['excludes']
    elif current_type is not None:
        exclusions = [{
            'key': row.to_type.key,
            'note': row.note,
        } for row in current_type.exclusions.select_related('to_type').all()]
    else:
        exclusions = []
    values['exclusions'], error = _validate_exclusions(
        exclusions,
        values['version'],
        agreement_type.pk,
        current_type=current_type,
    )
    if error:
        return None, error

    if 'is_active' in payload:
        if not isinstance(payload['is_active'], bool):
            return None, 'is_active must be a boolean.'
        values['is_active'] = payload['is_active']
    else:
        values['is_active'] = current_type.is_active if current_type else True
    return values, None


def _save_type(canonical_type, values, *, creating):
    canonical_type.version = values['version']
    canonical_type.applies_to = values['applies_to']
    canonical_type.number = values['number']
    canonical_type.key = values['key']
    canonical_type.name = values['name']
    canonical_type.definition = values['definition']
    canonical_type.aliases = values['aliases']
    canonical_type.agreement_type = values['agreement_type']
    canonical_type.is_active = values['is_active']
    if creating:
        last_order = (
            CanonicalType.objects.filter(
                version=values['version'],
                agreement_type=values['agreement_type'],
            )
            .order_by('-sort_order')
            .values_list('sort_order', flat=True)
            .first()
        )
        canonical_type.sort_order = (last_order or 0) + 1

    with transaction.atomic():
        canonical_type.save()
        canonical_type.alias_rows.all().delete()
        CanonicalTypeAlias.objects.bulk_create([
            CanonicalTypeAlias(
                canonical_type=canonical_type,
                agreement_type=canonical_type.agreement_type,
                version=canonical_type.version,
                alias=alias['alias'],
                match_key=alias['match_key'],
                is_literal=alias['is_literal'],
                note=alias['note'],
                position=index,
            )
            for index, alias in enumerate(values['aliases'])
        ])
        canonical_type.exclusions.all().delete()
        CanonicalTypeExclusion.objects.bulk_create([
            CanonicalTypeExclusion(
                from_type=canonical_type,
                to_type=target,
                note=note,
                position=index,
            )
            for index, (target, note) in enumerate(values['exclusions'])
        ])


def _save_error_response():
    return JsonResponse({
        'detail': (
            'A canonical type with this key, name, number, or literal alias '
            'already exists in this agreement type and version.'
        ),
    }, status=409)


@csrf_exempt
@require_http_methods(['POST'])
@require_auth
def canonical_type_create(request):
    payload, error = _json_body(request)
    if error:
        return error
    values, error = _prepare_values(payload)
    if error:
        return JsonResponse({'detail': error}, status=400)
    canonical_type = CanonicalType()
    try:
        _save_type(canonical_type, values, creating=True)
    except IntegrityError:
        return _save_error_response()
    canonical_type = (
        CanonicalType.objects.select_related('agreement_type')
        .prefetch_related('alias_rows', 'exclusions__to_type')
        .get(pk=canonical_type.pk)
    )
    return JsonResponse(_type_data(canonical_type), status=201)


@csrf_exempt
@require_http_methods(['GET', 'POST'])
def canonical_type_collection(request):
    if request.method == 'GET':
        return canonical_type_list(request)
    return canonical_type_create(request)


@csrf_exempt
@require_http_methods(['PATCH'])
@require_auth
def canonical_type_detail(request, type_id):
    canonical_type = (
        CanonicalType.objects.select_related('agreement_type')
        .filter(pk=type_id)
        .first()
    )
    if canonical_type is None:
        return JsonResponse({'detail': 'No canonical type with that id.'}, status=404)
    payload, error = _json_body(request)
    if error:
        return error
    values, error = _prepare_values(payload, current_type=canonical_type)
    if error:
        return JsonResponse({'detail': error}, status=400)
    try:
        _save_type(canonical_type, values, creating=False)
    except IntegrityError:
        return _save_error_response()
    canonical_type = (
        CanonicalType.objects.select_related('agreement_type')
        .prefetch_related('alias_rows', 'exclusions__to_type')
        .get(pk=canonical_type.pk)
    )
    return JsonResponse(_type_data(canonical_type))
