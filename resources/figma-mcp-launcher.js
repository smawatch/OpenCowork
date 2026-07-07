// figma-pilot-mcp launcher — spawned by Electron in Node.js mode
// Packaged: __dirname = resources/app.asar.unpacked/resources/
// Dev:      __dirname = <project>/resources/
const path = require('path')
const Module = require('module')

const resourcesDir = __dirname.endsWith('resources') ? __dirname : path.join(__dirname, '..', '..')
const asarNodeModules = path.join(resourcesDir, 'app.asar', 'node_modules')
const asarUnpackedNodeModules = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules')

// Help Node.js find modules in asar
function addModulePath(p) {
  try {
    if (require('fs').existsSync(p) && !Module.globalPaths.includes(p)) {
      Module.globalPaths.push(p)
    }
  } catch (_) {}
}
addModulePath(asarUnpackedNodeModules)
addModulePath(asarNodeModules)

// Resolve the package
const pkgName = '@youware-labs/figma-pilot-mcp'
let pkgPath
try {
  pkgPath = require.resolve(pkgName + '/dist/index.js')
} catch (_) {
  try {
    pkgPath = require.resolve(path.join(asarUnpackedNodeModules, pkgName, 'dist', 'index.js'))
  } catch (_) {
    try {
      pkgPath = require.resolve(path.join(asarNodeModules, pkgName, 'dist', 'index.js'))
    } catch (_) {
      // Dev fallback: ../node_modules/
      pkgPath = require.resolve(path.join(__dirname, '..', 'node_modules', pkgName, 'dist', 'index.js'))
    }
  }
}

require(pkgPath)
