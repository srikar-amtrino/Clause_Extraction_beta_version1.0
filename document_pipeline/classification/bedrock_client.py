"""The one place that talks to Bedrock.

Tests replace this seam and never touch the network. It returns the response
text rather than a parsed object: validation happens in the service, which is
also where a response that fails validation still gets stored for audit. The
SDK's messages.parse() raises on a bad answer and loses the raw text with it.

Failures split in two, because they need opposite handling:

- ConfigurationError: Bedrock refused the request itself (credentials,
  permissions, an unknown model, a malformed request). Every other request in
  the run would fail the same way, so the run stops.
- TransientError: throttling, a 5xx or a dropped connection that outlasted the
  SDK's own retries with backoff. Also stops the run: a run promoted with half
  its items failed would replace a good earlier run with a worse one.

The retries for transient failures are the SDK's (max_retries), not a wrapper
of our own on top. Stacking a second retry loop multiplies calls, and wrapping
everything would also retry permanent validation failures.
"""
import time
from dataclasses import dataclass

from django.conf import settings

import anthropic

CLIENTS = {
    'invoke': anthropic.AnthropicBedrock,
    'mantle': anthropic.AnthropicBedrockMantle,
}


class ConfigurationError(Exception):
    """Bedrock rejected the request itself. Retrying cannot help."""


class TransientError(Exception):
    """Bedrock stayed unavailable after the SDK's own retries."""


@dataclass
class CallResult:
    text: str | None
    stop_reason: str | None
    request_id: str
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    latency_ms: int


class BedrockClassifier:
    """One configured model on one Bedrock endpoint."""

    def __init__(self, *, client_kind, region, model_id, max_tokens, max_retries,
                 thinking='', effort=''):
        if client_kind not in CLIENTS:
            raise ConfigurationError('BEDROCK_CLIENT must be one of %s, not %r.'
                                     % (', '.join(sorted(CLIENTS)), client_kind))
        if not region:
            raise ConfigurationError('AWS_REGION is not set.')
        if not model_id:
            raise ConfigurationError('CLASSIFY_MODEL_ID is not set.')
        if thinking not in ('', 'adaptive'):
            raise ConfigurationError('CLASSIFY_THINKING must be blank or "adaptive", not %r.'
                                     % thinking)
        self.client_kind = client_kind
        self.region = region
        self.model_id = model_id
        self.max_tokens = max_tokens
        self.thinking = thinking
        self.effort = effort
        # Credentials come from the standard AWS environment variables through
        # the SDK's own credential chain; they are never passed around here.
        self._client = CLIENTS[client_kind](aws_region=region, max_retries=max_retries)

    def complete(self, system, user_text, output_format):
        """One request. -> CallResult, or raises ConfigurationError / TransientError."""
        output_config = {'format': output_format}
        if self.effort:
            output_config['effort'] = self.effort
        kwargs = dict(model=self.model_id, max_tokens=self.max_tokens, system=system,
                      messages=[{'role': 'user', 'content': user_text}],
                      output_config=output_config)
        if self.thinking:
            kwargs['thinking'] = {'type': self.thinking}

        started = time.perf_counter()
        try:
            # The raw form exposes the headers: Bedrock returns its request id
            # as x-amzn-requestid, which the parsed message does not carry.
            raw = self._client.messages.with_raw_response.create(**kwargs)
            response = raw.parse()
        except anthropic.APIStatusError as exc:
            detail = 'HTTP %s from Bedrock: %s' % (exc.status_code, _message(exc))
            if exc.status_code in (408, 409, 429) or exc.status_code >= 500:
                raise TransientError(detail) from exc
            raise ConfigurationError(detail) from exc
        except anthropic.APIConnectionError as exc:
            raise TransientError('could not reach Bedrock in %s: %s' % (self.region, exc)) from exc
        except Exception as exc:
            # Credential resolution happens before any HTTP request, in
            # botocore, and surfaces as its own exception types.
            if type(exc).__module__.startswith('botocore'):
                raise ConfigurationError('AWS credentials: %s' % exc) from exc
            raise
        latency_ms = int((time.perf_counter() - started) * 1000)

        usage = response.usage
        return CallResult(
            text=next((b.text for b in response.content if b.type == 'text'), None),
            stop_reason=response.stop_reason,
            request_id=(raw.headers.get('x-amzn-requestid') or raw.headers.get('request-id')
                        or getattr(response, '_request_id', None) or ''),
            input_tokens=usage.input_tokens or 0,
            output_tokens=usage.output_tokens or 0,
            cache_read_tokens=getattr(usage, 'cache_read_input_tokens', None) or 0,
            cache_write_tokens=getattr(usage, 'cache_creation_input_tokens', None) or 0,
            latency_ms=latency_ms,
        )


def _message(exc):
    body = getattr(exc, 'body', None)
    if isinstance(body, dict):
        error = body.get('error')
        if isinstance(error, dict) and error.get('message'):
            return error['message']
        if body.get('message'):
            return body['message']
    return str(getattr(exc, 'message', exc))


def classifier_from_settings():
    return BedrockClassifier(
        client_kind=settings.BEDROCK_CLIENT,
        region=settings.AWS_REGION,
        model_id=settings.CLASSIFY_MODEL_ID,
        max_tokens=settings.CLASSIFY_MAX_TOKENS,
        max_retries=settings.CLASSIFY_SDK_MAX_RETRIES,
        thinking=settings.CLASSIFY_THINKING,
        effort=settings.CLASSIFY_EFFORT,
    )
