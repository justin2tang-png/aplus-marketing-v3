'use strict';
class ProviderRegistry {
 constructor(){this.providers=new Map();}
 register(provider){if(!provider || typeof provider.id!=='string'||typeof provider.label!=='string'||typeof provider.generate!=='function') throw Error('Invalid provider');this.providers.set(provider.id,provider);return this;}
 get(id){const p=this.providers.get(id);if(!p)throw Error(`Unknown provider: ${id}`);return p;}
 list(){return [...this.providers.values()].map(({id,label})=>({id,label}));}
}
const registry=new ProviderRegistry(); registry.register(require('./mock')); registry.register(require('./pi-cli'));
module.exports=registry; module.exports.ProviderRegistry=ProviderRegistry;
