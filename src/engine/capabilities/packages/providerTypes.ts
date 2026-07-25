/**
 * packages capability가 시스템 상태를 읽는 유일한 통로. capture/diff/plan은
 * 이 인터페이스만 알고, 실제 apt-mark/snap/flatpak 호출이나 /etc/apt 파일
 * 읽기는 절대 직접 하지 않는다 — P2a 확정 결정 ⑥: "테스트 환경에서 시스템
 * 명령 호출 금지, provider는 인터페이스 뒤로 격리". 테스트는 이 인터페이스의
 * fake 구현을 주입하고, 실제 구현(`src/engine/providers/linux/*`)은 dev에서만
 * 쓰인다.
 */

export interface AptSourceFile {
  readonly name: string
  readonly content: string
}

export interface AptProvider {
  /** apt-mark가 PATH에 있는지 (없으면 이 provider는 skip 취급). */
  isAvailable(): boolean
  /** `apt-mark showmanual` — 사용자가 수동 설치한 패키지 이름 목록. */
  manualInstalled(): string[]
  /** `/etc/apt/sources.list.d/*` 각 파일의 이름+내용. */
  listSourceFiles(): AptSourceFile[]
  /** 임의의 절대경로가 실제로 존재하는 일반 파일인지 (sources.list.d 항목·키링 경로 확인용). */
  fileExists(absPath: string): boolean
  /** 임의의 절대경로 파일을 바이트로 읽는다 (없거나 못 읽으면 null). */
  readFileBytes(absPath: string): Buffer | null
}

export interface SnapListRow {
  readonly name: string
  readonly notes: string
}

export interface SnapProvider {
  isAvailable(): boolean
  /** `snap list` 파싱 결과. */
  list(): SnapListRow[]
}

export interface FlatpakRemoteRow {
  readonly name: string
  readonly url: string
}

export interface FlatpakAppRow {
  readonly application: string
  readonly origin: string
  readonly installation: string
}

export interface FlatpakCommandResult {
  readonly ok: boolean
  readonly output: string
}

export interface FlatpakOverrideFile {
  /** 파일명 = flatpak app ID (예: "org.gimp.GIMP"). */
  readonly appId: string
  readonly content: string
}

export interface FlatpakProvider {
  isAvailable(): boolean
  remotes(): FlatpakRemoteRow[]
  apps(): FlatpakAppRow[]
  /**
   * `flatpak remote-add --user --if-not-exists <name> <url>`. `--user`라
   * unprivileged로 실행 가능(P2a 결정 ②) — apt/snap과 달리 실제로 실행된다.
   */
  addRemoteUser(name: string, url: string): FlatpakCommandResult
  /** `flatpak install --user -y <origin> <application>`. */
  installAppUser(origin: string, application: string): FlatpakCommandResult
  /**
   * `~/.local/share/flatpak/overrides/*` 각 파일의 appId(파일명)+내용 —
   * 정책 §3.2 "권한 오버라이드는 반드시 함께 동기화" (P2c 결정 ④). apt의
   * `listSourceFiles`와 같은 역할: 라이브 시스템 조회를 provider 뒤로 격리한다.
   */
  listOverrideFiles(): FlatpakOverrideFile[]
  overrideFileExists(appId: string): boolean
  readOverrideFileBytes(appId: string): Buffer | null
  /**
   * 라이브 override 파일을 덮어쓴다(호출 전 백업은 호출자 책임). 이 메서드
   * 뒤로 격리하는 이유는 apt/keyring 쪽과 달리 override 복원은 unprivileged라
   * plan의 `run()`이 테스트에서도 실제로 호출되기 때문 — 그 경로가 raw
   * `fs`/`os.homedir()`를 직접 쓰면 테스트가 개발자의 진짜 홈을 건드리게 된다.
   */
  writeOverrideFile(appId: string, content: Buffer): FlatpakCommandResult
}

export interface PackageProviders {
  readonly apt: AptProvider
  readonly snap: SnapProvider
  readonly flatpak: FlatpakProvider
}
