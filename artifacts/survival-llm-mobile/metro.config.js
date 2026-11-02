// expo-sqlite's web build (wa-sqlite) imports a .wasm file; Metro must serve it as an asset.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

module.exports = config;
