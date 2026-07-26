export { buildFontsSyncGroup } from './candidates'
export { captureFonts, FollowerFontsCaptureBlockedError, type CaptureFontsOptions } from './capture'
export { checkFontsPreflight, type FontsPreflightCheck } from './checks'
export { diffFonts } from './diff'
export { getKnownFontDefinition, identifyFontFamily, KNOWN_FONTS } from './knownFontSources'
export { planFonts } from './plan'
export type {
  FontAssetResolver,
  FontDownloader,
  FontDownloadResult,
  FontReleaseAsset,
  FontsSystemCommandResult,
  FontsSystemProvider,
  ZipExtractor,
  ZipExtractResult
} from './providerTypes'
export {
  fontDirs,
  fontInstallDir,
  groupInstalledFontFiles,
  scanInstalledFontFiles,
  type GroupedInstalledFonts
} from './scan'
export type {
  FontEntry,
  FontGithubReleaseSource,
  FontSource,
  FontSourceKind,
  FontsCaptureReport,
  FontsDiffReport,
  FontsPinMismatch,
  FontStaticSource
} from './types'
