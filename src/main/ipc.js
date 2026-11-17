'use strict';

const { buildCopyPrompt, parseCopyOutput } = require('./prompt');

/** Register validated handlers for the renderer IPC API. */
function registerIpc({
  ipcMain,
  repo: repository,
  settings,
  backup,
  registry,
  app,
  window
}) {
  const validateString = (value, name, max = 10000) => {
    if (typeof value !== 'string' || value.length > max) {
      throw Error(`Invalid ${name}`);
    }
    return value;
  };
  const validateObject = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Error('Invalid object');
    }
    return value;
  };
  const validateId = value => {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw Error('Invalid id');
    }
    return value;
  };
  const validateContent = value => {
    validateObject(value);
    const result = {};
    for (const [key, fieldValue] of Object.entries(value)) {
      if (!['topic', 'title', 'body', 'platform', 'status', 'provider', 'model'].includes(key)) {
        throw Error('Invalid content field');
      }
      result[key] = validateString(fieldValue, key, key === 'body' ? 200000 : 1000);
    }
    if (result.status && !['draft', 'approved'].includes(result.status)) {
      throw Error('Invalid status');
    }
    return result;
  };
  const handlers = {
    'content:list': value => repository.listContents(value === undefined ? {} : {
      search: validateString(validateObject(value).search ?? '', 'search', 1000)
    }),
    'content:get': value => repository.getContent(validateId(value)),
    'content:create': value => repository.createContent(validateContent(value)),
    'content:update': value => {
      validateObject(value);
      return repository.updateContent(validateId(value.id), validateContent(value.patch));
    },
    'content:delete': value => repository.deleteContent(validateId(value)),
    'ai:providers': () => registry.list(),
    'pi:diagnostics': () => registry.get('pi-cli').diagnostics(settings.getAll()),
    'ai:generate': async value => {
      validateObject(value);
      const topic = validateString(value.topic, 'topic', 10000);
      if (!topic.trim()) {
        throw Error('Topic is required');
      }
      const platform = validateString(value.platform, 'platform', 100);
      const tone = validateString(value.tone, 'tone', 100);
      const config = settings.getAll();
      const provider = registry.get(config['ai.provider']);
      const result = await provider.generate({
        prompt: buildCopyPrompt({
          topic,
          platform,
          tone,
          brandName: config['brand.name']
        }),
        topic,
        settings: config
      });
      return {
        ...parseCopyOutput(result.text, topic),
        provider: provider.id,
        model: result.model
      };
    },
    'settings:get': () => settings.getAll(),
    'settings:save': value => {
      validateObject(value);
      if (value['ai.provider']) {
        registry.get(value['ai.provider']);
      }
      const saved = settings.save(value);
      backup.keep = saved['backup.keep'];
      return saved;
    },
    'secrets:set': value => {
      validateObject(value);
      settings.setSecret(value.name, value.value);
      return settings.status();
    },
    'secrets:clear': value => {
      validateObject(value);
      settings.clearSecret(value.name);
      return settings.status();
    },
    'secrets:status': () => settings.status(),
    'backup:status': () => backup.status(),
    'backup:now': () => backup.runBackup(),
    'app:info': () => ({
      version: app.getVersion(),
      userData: app.getPath('userData'),
      platform: process.platform
    })
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, value) => {
      if (window && (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)) {
        throw Error('Untrusted IPC sender');
      }
      return handler(value);
    });
  }
  return () => Object.keys(handlers).forEach(c => ipcMain.removeHandler(c));
}

module.exports = {
  registerIpc
};
