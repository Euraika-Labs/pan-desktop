const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName

  if (platform === 'darwin') {
    const appPath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`
    )
    console.log(`Ad-hoc re-signing: ${appPath}`)
    execSync(
      `codesign --force --deep --sign - "${appPath}"`,
      { stdio: 'inherit' }
    )
    return
  }

  if (platform === 'win32') {
    // M1 ships unsigned (Path A — see docs/DECISIONS_M1.md §4).
    // When activating signing in M1.1, add signtool invocation here or rely on
    // electron-builder's win.sign config instead.
    return
  }

  // Linux and others: no post-pack signing.
}
