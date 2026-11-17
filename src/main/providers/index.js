'use strict';

/** Register and look up AI providers. */
class ProviderRegistry {

  /** Create an empty provider registry. */
  constructor() {
    this.providers = new Map();
  }

  /** Validate and register a provider by its ID. */
  register(provider) {
    if (!provider || typeof provider.id !== 'string' || typeof provider.label !== 'string' || typeof provider.generate !== 'function') {
      throw Error('Invalid provider');
    }
    this.providers.set(provider.id, provider);
    return this;
  }

  /** Look up a provider or throw when it is unknown. */
  get(id) {
    const provider = this.providers.get(id);
    if (!provider) {
      throw Error(`Unknown provider: ${id}`);
    }
    return provider;
  }

  /** List provider IDs and labels for the renderer. */
  list() {
    return [...this.providers.values()].map(({
      id,
      label
    }) => ({
      id,
      label
    }));
  }
}
const registry = new ProviderRegistry();
registry.register(require('./mock'));
registry.register(require('./pi-cli'));

module.exports = registry;
module.exports.ProviderRegistry = ProviderRegistry;
