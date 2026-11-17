'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redactSecrets } = require('../../src/main/redact');

const cases = [
  ['OpenAI key', 'using sk-proj-AbCdEf1234567890xyz now', 'using sk-[REDACTED] now'],
  ['Bearer token', 'Authorization: Bearer abc.def-ghi_jkl012', 'Authorization: Bearer [REDACTED]'],
  ['JWT', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig-part_1 end', 'token [REDACTED_JWT] end'],
  ['api_key assignment', 'api_key=abcd1234', 'api_key=[REDACTED]'],
  ['token colon JSON', '{"access_token": "zzz999"}', '{"access_token": "[REDACTED]"}'],
  ['password assignment', 'password = hunter2', 'password = [REDACTED]'],
];
for (const [name, input, expected] of cases) {
  test(`redactSecrets hides ${name} (QA P2-4)`, () => {
    assert.equal(redactSecrets(input), expected);
  });
}

test('redactSecrets leaves ordinary text and Chinese untouched', () => {
  const text = 'Pi failed: model gpt-6.1-sol not found 首次置业 KiwiSaver';
  assert.equal(redactSecrets(text), text);
});

test('redactSecrets tolerates null and undefined', () => {
  assert.equal(redactSecrets(undefined), '');
  assert.equal(redactSecrets(null), '');
});
