/**
 * Patches @more-tech/react-native-libsodium's CMakeLists.txt to normalize
 * NODE_MODULES_DIR before use.
 *
 * On Windows the variable arrives with backslashes (D:\Programming\...), and
 * CMake reads a backslash inside a quoted argument as an escape sequence. The
 * first path segment that does not happen to be a valid escape ("\P" here)
 * aborts configuration with:
 *
 *   CMake Error at CMakeLists.txt:34 (add_library):
 *     Syntax error in cmake code when parsing string
 *     D:\...\node_modules/react-native/ReactCommon/jsi/jsi/jsi.cpp
 *     Invalid character escape '\P'.
 *
 * Forward slashes work on every platform CMake targets, so one string(REPLACE)
 * at the top of the file fixes Windows without touching the other platforms.
 *
 * Applied here rather than through `pnpm patch` because that package ships a
 * bundled `libsodium/` C source tree rather than a standard npm layout, and
 * pnpm's patch-apply step fails on it with:
 *
 *   ERR_PNPM_ENOENT scandir '.../@more-tech/react-native-libsodium_tmp_<pid>/node_modules'
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'HPY_WINDOWS_PATH_FIX';
const ANCHOR = 'cmake_minimum_required(VERSION 3.4.1)';
const FIX = `${ANCHOR}

# ${MARKER}: NODE_MODULES_DIR arrives with backslashes on Windows, and CMake
# treats a backslash inside a quoted argument as an escape sequence. Forward
# slashes are valid on every platform CMake targets.
string(REPLACE "\\\\" "/" NODE_MODULES_DIR "\${NODE_MODULES_DIR}")`;

const nodeModulesRoots = [
    path.resolve(__dirname, '..', 'node_modules'),
    path.resolve(__dirname, '..', 'packages/happy-app/node_modules'),
];

let patched = 0;

for (const nodeModulesRoot of nodeModulesRoots) {
    const cmakeFile = path.join(
        nodeModulesRoot,
        '@more-tech/react-native-libsodium/android/CMakeLists.txt'
    );
    if (!fs.existsSync(cmakeFile)) continue;

    const content = fs.readFileSync(cmakeFile, 'utf8');
    if (content.includes(MARKER)) continue;          // already patched
    if (!content.startsWith(ANCHOR)) {
        console.warn(`[fix-libsodium-windows-path] unexpected CMakeLists layout: ${cmakeFile}`);
        continue;
    }

    fs.writeFileSync(cmakeFile, content.replace(ANCHOR, FIX), 'utf8');
    patched++;
    console.log(`[fix-libsodium-windows-path] patched ${cmakeFile}`);
}

if (patched === 0) {
    console.log('[fix-libsodium-windows-path] nothing to patch');
}
