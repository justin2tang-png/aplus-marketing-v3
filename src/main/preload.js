'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const channels=['content:list','content:get','content:create','content:update','content:delete','ai:generate','ai:providers','settings:get','settings:save','secrets:set','secrets:clear','secrets:status','backup:status','backup:now','app:info'];
const api={};for(const channel of channels)api[channel]=value=>ipcRenderer.invoke(channel,value);
contextBridge.exposeInMainWorld('aplus',Object.freeze(api));
