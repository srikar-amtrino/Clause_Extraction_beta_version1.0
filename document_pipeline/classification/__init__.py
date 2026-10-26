"""Classification stage: label every micro chunk against a versioned taxonomy.

The orchestration lives in services/classification_service.py. This package
holds the pieces it composes, each testable on its own: the vocabulary
(taxonomy), the output schema (schema), the prompt (prompt), batching
(batching) and the one seam that talks to Bedrock (bedrock_client).
"""
