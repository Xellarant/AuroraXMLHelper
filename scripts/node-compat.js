// Match the minimum runtime required by the installed Vite/Vitest toolchain.
function supportsNode(version) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  return Number.isInteger(major) && Number.isInteger(minor)
    && (major === 20 && minor >= 19 || major === 22 && minor >= 12 || major > 22);
}
module.exports = { supportsNode };
