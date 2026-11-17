'use strict';

/**
 * Best-effort redaction of credentials in text that may be shown in the UI or logged
 * (e.g. a CLI's stderr tail). Not a guarantee — providers must still never print secrets.
 */
const RULES = [
  // OpenAI-style keys: sk-..., sk-proj-...
  [/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]'],
  // Authorization: Bearer <token>
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [REDACTED]'],
  // JWTs (header.payload[.signature])
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?/g, '[REDACTED_JWT]'],
  // key=value / token: value style assignments (api_key, access_token, secret, password, ...)
  [/\b([A-Za-z0-9_.-]*(?:api[_-]?key|key|token|secret|password|passwd))(\s*["']?\s*[=:]\s*["']?)([^\s"'&,;]+)/gi, '$1$2[REDACTED]'],
];

/** Return `text` with known credential patterns replaced by placeholders. */
function redactSecrets(text) {
  let output = String(text ?? '');
  for (const [pattern, replacement] of RULES) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

module.exports = { redactSecrets };
