export { ApplyRunner, type ApplyRunnerEvents, type ApplyRunnerOptions } from './applyRunner'
export { MARKER_CMD_RE, MARKER_DONE, MARKER_FAIL_RE, markerCmd, markerFail } from './constants'
export type { ElevationExec, ElevationSpawnOptions, ElevationSpawnResult } from './execTypes'
export { makeCancelFilePath, pkexecAvailable, safeUnlink, writeSudoScript } from './fsHelpers'
export {
  parseSudoScriptOutput,
  SudoStreamParser,
  type SudoCommandStatus,
  type SudoEvent
} from './parse'
export { buildSudoScriptPreview } from './preview'
export { runSudoScript, type RunSudoScriptResult, type SudoOutcome } from './runner'
export { buildSudoScript } from './script'
export {
  flattenPrivilegedCommands,
  splitPlanByPrivilege,
  type FlattenedSudoCommands
} from './split'
