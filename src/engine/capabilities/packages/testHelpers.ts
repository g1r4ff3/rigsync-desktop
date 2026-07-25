/**
 * packages 테스트 전용 fake provider — 이 파일은 Vitest include 패턴에
 * 안 걸리므로 테스트 파일이 아니다. **실제 apt-mark/snap/flatpak 호출이나
 * /etc/apt 파일 접근은 여기 어디에도 없다** (P2a 결정 ⑥).
 */
import type {
  AptProvider,
  AptSourceFile,
  FlatpakAppRow,
  FlatpakCommandResult,
  FlatpakProvider,
  FlatpakRemoteRow,
  SnapListRow,
  SnapProvider
} from './providerTypes'

export interface FakeAptProviderOptions {
  readonly available?: boolean
  readonly manual?: readonly string[]
  readonly sourceFiles?: readonly AptSourceFile[]
  /** 절대경로 -> 내용. `fileExists`/`readFileBytes`가 여기서만 답한다. */
  readonly files?: Readonly<Record<string, string | Buffer>>
}

export function makeFakeAptProvider(opts: FakeAptProviderOptions = {}): AptProvider {
  const files = new Map<string, Buffer>(
    Object.entries(opts.files ?? {}).map(([k, v]) => [k, Buffer.isBuffer(v) ? v : Buffer.from(v)])
  )
  return {
    isAvailable: () => opts.available ?? true,
    manualInstalled: () => [...(opts.manual ?? [])],
    listSourceFiles: () => [...(opts.sourceFiles ?? [])],
    fileExists: (p) => files.has(p),
    readFileBytes: (p) => files.get(p) ?? null
  }
}

export function makeFakeSnapProvider(
  rows: readonly SnapListRow[] = [],
  available = true
): SnapProvider {
  return {
    isAvailable: () => available,
    list: () => [...rows]
  }
}

export interface FakeFlatpakProviderOptions {
  readonly available?: boolean
  readonly remotes?: readonly FlatpakRemoteRow[]
  readonly apps?: readonly FlatpakAppRow[]
  readonly addRemoteResult?: FlatpakCommandResult
  readonly installResult?: FlatpakCommandResult
}

export interface FakeFlatpakProvider extends FlatpakProvider {
  readonly addRemoteCalls: Array<{ name: string; url: string }>
  readonly installCalls: Array<{ origin: string; application: string }>
}

export function makeFakeFlatpakProvider(
  opts: FakeFlatpakProviderOptions = {}
): FakeFlatpakProvider {
  const addRemoteCalls: Array<{ name: string; url: string }> = []
  const installCalls: Array<{ origin: string; application: string }> = []
  return {
    isAvailable: () => opts.available ?? true,
    remotes: () => [...(opts.remotes ?? [])],
    apps: () => [...(opts.apps ?? [])],
    addRemoteUser: (name, url) => {
      addRemoteCalls.push({ name, url })
      return opts.addRemoteResult ?? { ok: true, output: '' }
    },
    installAppUser: (origin, application) => {
      installCalls.push({ origin, application })
      return opts.installResult ?? { ok: true, output: '' }
    },
    addRemoteCalls,
    installCalls
  }
}
