'use strict';

/** Build a social post prompt with the brand compliance rules. */
function buildCopyPrompt({
  topic,
  platform = 'Facebook',
  tone = 'friendly professional',
  brandName = 'A Plus Finance'
}) {
  return `Write one ${platform} social post for ${brandName} (NZ) about: ${topic}\nUse NZ English and a ${tone}, friendly professional tone. No guaranteed approval. No "lowest rate" or specific rate promises unless given in the topic. No fabricated testimonials or statistics. End the body with this exact short line: General information only — not financial advice. Talk to an adviser about your situation.\nReturn ONLY JSON {"title":"...","body":"...","hashtags":["..."]}.`;
}

/** Extract a valid post from JSON output or return a plain text fallback. */
function parseCopyOutput(stdout, topic = 'Social post') {
  for (let start = stdout.indexOf('{'); start !== -1; start = stdout.indexOf('{', start + 1)) {
    let depth = 0;
    let string = false;
    let escape = false;
    for (let i = start; i < stdout.length; i++) {
      const character = stdout[i];
      if (string) {
        if (escape) {
          escape = false;
        } else if (character === '\\') {
          escape = true;
        } else if (character === '"') {
          string = false;
        }
      } else if (character === '"') {
        string = true;
      } else if (character === '{') {
        depth++;
      } else if (character === '}' && --depth === 0) {
        try {
          const post = JSON.parse(stdout.slice(start, i + 1));
          if (typeof post.title === 'string' && typeof post.body === 'string') {
            return {
              title: post.title,
              body: post.body + (Array.isArray(post.hashtags) && post.hashtags.length ? '\n\n' + post.hashtags.filter(hashtag => typeof hashtag === 'string').join(' ') : '')
            };
          }
        } catch {}
        break;
      }
    }
  }
  return {
    title: topic.slice(0, 120),
    body: stdout.trim()
  };
}

module.exports = {
  buildCopyPrompt,
  parseCopyOutput
};
