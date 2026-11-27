'use strict';
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld(
  'pccDesktop',
  Object.freeze({
    isDesktop: true,
    platform: process.platform,
  })
);
