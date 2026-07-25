export const TOOLS_LAYER = 'tools'
/** nvm 설치 스크립트 버전 핀 기본값 — 구 repo 기본값과 동일. */
export const DEFAULT_NVM_VERSION = 'v0.40.3'
/**
 * nvm을 non-login bash에 source한다 — GUI(로그인 셸 아님)나 nvm이 방금 설치된
 * 직후에도 이후 명령이 동일하게 동작하도록. 구 repo `_NVM_SOURCE` 그대로.
 */
export const NVM_SOURCE =
  'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'
