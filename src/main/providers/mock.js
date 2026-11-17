'use strict';

module.exports = {
  id: 'mock',
  label: 'Mock (offline)',

  /** Generate a post using this provider. */
  async generate({
    topic,
    signal
  }) {
    await new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(Error('Generation cancelled'));
      }

      const abort = () => {
        clearTimeout(timer);
        reject(Error('Generation cancelled'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, 200);
      signal?.addEventListener('abort', abort, {
        once: true
      });
    });
    return {
      text: JSON.stringify({
        title: `Mock: ${topic}`,
        body: `A Plus Finance: ${topic}\n\nGeneral information only — not financial advice. Talk to an adviser about your situation.`,
        hashtags: ['#APlusFinance']
      }),
      model: 'mock-1'
    };
  }
};
