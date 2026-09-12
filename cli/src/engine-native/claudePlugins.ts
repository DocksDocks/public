/**
 * EngineNative `sync claude` plugin, optional-plugin, and LSP passes. Pass
 * order inside `syncPlugins` is load-bearing and golden-tested; message
 * strings and spawned argv are part of the contract.
 *
 * Split: install/refresh passes live in `claudePluginPasses.ts`, LSP server
 * probes in `claudeLsp.ts`. This module re-exports the public surface so
 * existing import paths keep working.
 */
export { pluginUserScopeInstalled, syncOptionalPlugins, syncPlugins } from "./claudePluginPasses"
export { syncLspServers } from "./claudeLsp"
