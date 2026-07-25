/**
 * src/engine 배럴. **여기와 하위 모듈은 Electron·React를 import하지 않는다**
 * — Node API만 써서 나중에 CLI·데몬이 그대로 재사용할 수 있어야 한다
 * (CLAUDE.md 아키텍처 규칙 / FORWARD.md §3).
 */
export * as capabilities from './capabilities'
export * as dotfiles from './capabilities/dotfiles'
export * as packages from './capabilities/packages'
export * as appimage from './capabilities/appimage'
export * as settings from './capabilities/settings'
export * as services from './capabilities/services'
export * as scheduled from './capabilities/scheduled'
export * as tools from './capabilities/tools'
export * as repos from './capabilities/repos'
export * as manifest from './manifest'
export * as plan from './plan'
export * as safety from './safety'
export * from './context'
export * as paths from './paths'
export * as ignore from './ignore'
export * as syncItems from './syncItems'
export * as elevation from './elevation'
export * as duplicates from './duplicates'
export * as reclassification from './reclassification'
export * as doctor from './doctor'
