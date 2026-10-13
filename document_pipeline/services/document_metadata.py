from document_pipeline.models import AgreementType, SectorType


def _resolve_type(value, model, label):
    if value is None or value == '':
        return None
    if isinstance(value, model):
        return value
    if isinstance(value, int) or (isinstance(value, str) and value.isdecimal()):
        result = model.objects.filter(pk=int(value)).first()
    else:
        result = model.objects.filter(name__iexact=str(value).strip()).first()
    if result is None:
        raise ValueError('Unknown %s: %s' % (label, value))
    return result


def resolve_agreement_type(value):
    return _resolve_type(value, AgreementType, 'agreement_type')


def resolve_sector_type(value):
    return _resolve_type(value, SectorType, 'sectorial_category')
