'use strict';

const $ = id => document.getElementById(id);
const api = (channel, value) => window.aplus[channel](value);
let generated = null;
let selected = null;
let toastTimer;

function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').textContent = '';
  }, 4000);
}

function action(operation) {
  return async () => {
    $('error').textContent = '';
    try {
      await operation();
    } catch (e) {
      $('error').textContent = e.message;
    }
  };
}

async function tab(name) {
  clearTimeout(toastTimer);
  $('toast').textContent = '';
  for (const id of ['create', 'library', 'settings']) {
    $(id).hidden = id !== name;
  }
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === name));
  if (name === 'library') {
    await library();
  }
  if (name === 'settings') {
    await loadSettings();
  }
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', action(() => tab(button.dataset.tab))));

async function generate() {
  if ($('generate').disabled) {
    return;
  }
  $('generate').disabled = true;
  $('regenerate').disabled = true;
  $('spinner').hidden = false;
  try {
    const input = {
      topic: $('topic').value,
      platform: $('platform').value,
      tone: $('tone').value
    };
    const result = await api('ai:generate', input);
    generated = {
      ...result,
      topic: input.topic,
      platform: input.platform
    };
    $('draft-title').value = result.title;
    $('draft-body').value = result.body;
    $('provider-badge').textContent = `${result.provider} / ${result.model}`;
    $('draft').hidden = false;
  } finally {
    $('generate').disabled = false;
    $('regenerate').disabled = false;
    $('spinner').hidden = true;
  }
}
$('generate').onclick = action(generate);
$('regenerate').onclick = action(generate);
$('save-draft').onclick = action(async () => {
  if (!generated) {
    throw Error('Generate a draft first');
  }
  await api('content:create', {
    ...generated,
    title: $('draft-title').value,
    body: $('draft-body').value,
    status: 'draft'
  });
  toast('已保存');
});

async function library() {
  const rows = await api('content:list', {
    search: $('search').value
  });
  $('library-list').replaceChildren();
  for (const row of rows) {
    const button = document.createElement('button');
    button.className = 'library-item';
    button.textContent = `${row.title} · ${row.platform} · ${row.status} · ${new Date(row.updated_at).toLocaleString()}`;
    button.onclick = action(async () => {
      selected = await api('content:get', row.id);
      $('edit-title').value = selected.title;
      $('edit-body').value = selected.body;
      $('edit-status').value = selected.status;
      $('editor').hidden = false;
    });
    $('library-list').append(button);
  }
}
$('search').oninput = action(library);
$('save-edit').onclick = action(async () => {
  if (!selected) {
    return;
  }
  selected = await api('content:update', {
    id: selected.id,
    patch: {
      title: $('edit-title').value,
      body: $('edit-body').value,
      status: $('edit-status').value
    }
  });
  await library();
  toast('已保存');
});
$('delete-item').onclick = action(async () => {
  if (selected && confirm('删除此内容？ Delete this item?')) {
    await api('content:delete', selected.id);
    selected = null;
    $('editor').hidden = true;
    await library();
  }
});
const fields = {
  'ai.provider': 'ai-provider',
  'pi.path': 'pi-path',
  'pi.provider': 'pi-provider',
  'pi.model': 'pi-model',
  'pi.thinking': 'pi-thinking',
  'pi.timeoutSec': 'pi-timeout',
  'pi.launchMode': 'pi-launch-mode',
  'pi.promptVia': 'pi-prompt-via',
  'pi.extraArgs': 'pi-extra-args',
  'brand.name': 'brand-name',
  'backup.keep': 'backup-keep'
};

async function secrets() {
  const status = await api('secrets:status');
  $('encryption-status').textContent = `Encryption: ${status.encryptionAvailable ? 'available' : 'unavailable'} · ${status.backend}`;
  $('save-secret').disabled = !status.encryptionAvailable;
  $('secret-list').replaceChildren();
  for (const item of status.names) {
    const paragraph = document.createElement('p');
    paragraph.textContent = `${item.name}: ${item.masked} `;
    const button = document.createElement('button');
    button.textContent = '清除 Clear';
    button.onclick = action(async () => {
      await api('secrets:clear', {
        name: item.name
      });
      await secrets();
    });
    paragraph.append(button);
    $('secret-list').append(paragraph);
  }
}

async function backup() {
  const status = await api('backup:status');
  $('backup-status').textContent = `Last: ${status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : 'Never'} · Count: ${status.count} · Folder: ${status.dir}`;
}

async function loadSettings() {
  const providers = await api('ai:providers');
  $('ai-provider').replaceChildren();
  for (const provider of providers) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.label;
    $('ai-provider').append(option);
  }
  const values = await api('settings:get');
  for (const [key, id] of Object.entries(fields)) {
    $(id).value = values[key];
  }
  await secrets();
  await backup();
}
$('save-settings').onclick = action(async () => {
  const values = {};
  for (const [key, id] of Object.entries(fields)) {
    values[key] = ['pi.timeoutSec', 'backup.keep'].includes(key) ? Number($(id).value) : $(id).value;
  }
  await api('settings:save', values);
  toast('设置已保存 Settings saved');
});
$('save-secret').onclick = action(async () => {
  const value = $('secret-value').value;
  $('secret-value').value = '';
  await api('secrets:set', {
    name: $('secret-name').value,
    value
  });
  await secrets();
  toast('密钥已保存');
});
$('backup-now').onclick = action(async () => {
  await api('backup:now');
  await backup();
  toast('备份完成');
});
action(() => tab('create'))();
