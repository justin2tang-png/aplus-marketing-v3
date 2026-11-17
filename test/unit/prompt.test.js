'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildCopyPrompt, parseCopyOutput } = require('../../src/main/prompt');
for (const requirement of ['First home', 'Instagram', 'A Plus Finance', 'NZ English', 'No guaranteed approval', 'lowest rate', 'No fabricated', 'General information only — not financial advice. Talk to an adviser about your situation.', 'ONLY JSON']) {
  test(`prompt includes ${requirement}`, () => {
    const prompt = buildCopyPrompt({
      topic: 'First home',
      platform: 'Instagram',
      tone: 'warm',
      brandName: 'A Plus Finance'
    });
    assert.ok(prompt.includes(requirement));
  });
}
test('parser accepts fenced JSON with surrounding text', () => {
  assert.deepEqual(parseCopyOutput('Intro ```json\n{"title":"Title","body":"Body"}\n```'), {
    title: 'Title',
    body: 'Body'
  });
});
test('parser preserves braces inside JSON strings', () => {
  assert.deepEqual(parseCopyOutput('{"title":"A {title}","body":"Body"}'), {
    title: 'A {title}',
    body: 'Body'
  });
});
test('parser appends hashtags to the body', () => {
  assert.equal(parseCopyOutput('{"title":"Title","body":"Body","hashtags":["#NZ","#Home"]}').body, 'Body\n\n#NZ #Home');
});
test('parser skips malformed objects before a valid post', () => {
  assert.deepEqual(parseCopyOutput('broken { oops } then {"title":"Yes","body":"OK"}'), {
    title: 'Yes',
    body: 'OK'
  });
});
test('parser falls back to trimmed text and a topic title', () => {
  assert.deepEqual(parseCopyOutput(' plain text ', 'My topic'), {
    title: 'My topic',
    body: 'plain text'
  });
});
test('parser rejects JSON with a non-string title', () => {
  assert.equal(parseCopyOutput('{"title":7,"body":"x"}').body, '{"title":7,"body":"x"}');
});
