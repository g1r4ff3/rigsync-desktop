/**
 * tools capability가 npm/node/nvm을 조회/설치하는 유일한 통로. 구 repo
 * `probe_npm_globals`/`probe_node_version`(rigsync.py:567-587)이 각각 `npm ls -g
 * --json`과 `node --version`을 부르던 것의 대응.
 */

export interface ToolsCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface ToolsProvider {
  /** npm과 node가 둘 다 PATH에 있는지 (구 repo `tool_available("npm") and tool_available("node")`). */
  npmNodeAvailable(): boolean
  /** `npm ls -g --json`의 dependencies를 이름→버전으로. */
  npmGlobals(): Record<string, string>
  /** `node --version`. */
  nodeVersion(): string
  /** nvm 설치 스크립트를 실행한다 (홈 디렉터리 작업, sudo 불필요). */
  installNvm(nvmVersion: string): ToolsCommandResult
  /** `nvm install <version> && nvm alias default <version>`을 nvm 소싱 후 실행. */
  installNodeAndSetDefault(nodeVersion: string): ToolsCommandResult
  /** `npm install -g <pkg>`을 nvm 소싱 후 실행. */
  installGlobalPackage(pkg: string): ToolsCommandResult
}
