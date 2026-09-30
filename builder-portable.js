'use strict';
/* 一次性配置：把自包含便携版输出到全新的 dist-out 目录，避开被占用的 release-new\win-unpacked
   用法：npx electron-builder --win portable --config builder-portable.js */
const pkg = require('./package.json');

module.exports = {
  ...pkg.build,
  directories: { ...(pkg.build.directories || {}), output: 'dist-out' },
};
