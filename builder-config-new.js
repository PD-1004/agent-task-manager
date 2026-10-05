'use strict';
/* 备用构建配置：把产物输出到 release-new，避免打包器去清理被占用的 release\win-unpacked。
   用法：npm run dist:new */
const pkg = require('./package.json');

module.exports = {
  ...pkg.build,
  directories: { ...(pkg.build.directories || {}), output: 'release-new' },
};
