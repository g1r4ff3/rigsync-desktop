/**
 * 내용 수준 비밀 스캔(content-level secret scanning) — 불변식 ③(시크릿
 * denylist)의 구멍을 메운다: denylist(`./denylist.ts`)는 **파일 이름**만 보므로
 * `~/.zshrc`처럼 이름이 평범한 파일 안에 박힌 GitHub PAT 등은 그대로 스토어에
 * 담겼다(실제 사고 직전 사례 — push 직전 코디네이터의 수동 grep으로 발견).
 * 이 모듈은 파일 **내용**을 스캔해 같은 실수를 기계적으로 잡는다.
 *
 * 값 비노출 규율(절대 규칙) — 이 모듈이 반환하는 `SecretFinding`은 절대
 * 매치된 원문 값을 담지 않는다. 담기는 것은 파일 경로 + 줄 번호 + 패턴
 * 종류 + (필요하면) 마스킹된 발췌뿐이다. `maskedExcerpt`는 각 패턴의
 * **공개적으로 알려진 고정 접두어**(예: GitHub PAT는 언제나 "ghp_"로
 * 시작한다는 사실 자체는 비밀이 아니다)만 노출하고 나머지는 고정된
 * `****`로 가린다 — 실제 엔트로피가 있는 문자는 단 하나도 내보내지 않는다.
 * generic(medium) 패턴은 값에 어떤 공개 접두어도 없으므로 발췌 자체를
 * `<key>=****`로 완전히 비운다.
 */
import fs from 'node:fs'
import path from 'node:path'

export type SecretPatternKind =
  | 'github-pat'
  | 'aws-access-key'
  | 'slack-token'
  | 'google-api-key'
  | 'anthropic-api-key'
  | 'openai-api-key'
  | 'pem-private-key'
  | 'generic-secret-assignment'

export type SecretConfidence = 'high' | 'medium'

export interface SecretFinding {
  /** 호출부가 넘긴 표시용 경로 (예: "~/.zshrc", "services/systemd-user/foo.service"). */
  readonly path: string
  /** 1-based 줄 번호. */
  readonly line: number
  readonly kind: SecretPatternKind
  readonly confidence: SecretConfidence
  /** 사람이 읽는 패턴 이름 (예: "GitHub personal access token"). */
  readonly label: string
  /** 절대 원문 값을 담지 않는다 -- 공개 접두어 + 고정 "****"만. */
  readonly maskedExcerpt: string
}

/** 이 크기를 넘는 파일은 스캔하지 않고 건너뛴다(캡처를 막지 않는다 -- 바이너리 아카이브 등). */
export const MAX_SCAN_BYTES = 1024 * 1024 // 1MB

export type FileScanOutcome =
  | { readonly kind: 'findings'; readonly findings: readonly SecretFinding[] }
  | { readonly kind: 'skipped-binary' }
  | { readonly kind: 'skipped-too-large'; readonly sizeBytes: number }

interface HighConfidencePatternDef {
  readonly kind: SecretPatternKind
  readonly label: string
  readonly regex: RegExp
  readonly mask: (matched: string) => string
}

function fixedPrefixMask(prefix: string): (matched: string) => string {
  return () => `${prefix}****`
}

function firstCharsMask(n: number): (matched: string) => string {
  return (matched) => `${matched.slice(0, n)}****`
}

/**
 * 고신뢰(즉시 차단) 패턴 — 형태가 고유해 오탐이 극히 드문 것만. 순서는
 * 판정에 영향 없다(sk-ant-/sk- 겹침은 openai 패턴의 부정 전방탐색으로 해소).
 */
const HIGH_CONFIDENCE_PATTERNS: readonly HighConfidencePatternDef[] = [
  {
    kind: 'github-pat',
    label: 'GitHub personal access token',
    regex: /\bgh[opusr]_[A-Za-z0-9]{36,}\b/g,
    mask: firstCharsMask(4) // "ghp_"/"gho_"/... -- 공개적으로 알려진 접두어
  },
  {
    kind: 'github-pat',
    label: 'GitHub fine-grained personal access token',
    regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    mask: fixedPrefixMask('github_pat_')
  },
  {
    kind: 'aws-access-key',
    label: 'AWS access key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    mask: fixedPrefixMask('AKIA')
  },
  {
    kind: 'slack-token',
    label: 'Slack token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    mask: firstCharsMask(5) // "xoxb-"/"xoxp-"/...
  },
  {
    kind: 'google-api-key',
    label: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35,}\b/g,
    mask: fixedPrefixMask('AIza')
  },
  {
    kind: 'anthropic-api-key',
    label: 'Anthropic API key',
    // sk-ant- 전용 -- openai 패턴보다 먼저 매치되도록 앞에 둔다(둘 다 걸어도
    // 안전하지만 anthropic 쪽 label이 더 정확하다).
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
    mask: fixedPrefixMask('sk-ant-')
  },
  {
    kind: 'openai-api-key',
    label: 'OpenAI API key',
    // sk-ant-는 이미 위에서 잡히므로 여기선 제외(중복 finding 방지).
    regex: /\bsk-(?!ant-)[A-Za-z0-9]{20,}\b/g,
    mask: fixedPrefixMask('sk-')
  },
  {
    kind: 'pem-private-key',
    label: 'PEM private key header',
    // 헤더 자체는 공개 보일러플레이트라(비밀 값이 아님) 그대로 노출해도 무방 --
    // 그래도 형식상 mask 함수는 통일해서 그대로 반환한다.
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    mask: (matched) => matched
  }
]

/** `$VAR`/`${VAR}`/명백한 placeholder/너무 짧은 값 -- medium 층 오탐 억제. */
function isPlaceholderOrEmptyValue(rawValue: string): boolean {
  const value = rawValue.trim()
  if (value.length === 0) return true
  if (value.startsWith('$')) return true // 변수 참조: $VAR, ${VAR}
  if (value.length < 8) return true // 너무 짧아 실제 비밀일 가능성이 낮음(노이즈 억제)
  const placeholderPatterns: readonly RegExp[] = [
    /^x+$/i,
    /^<.+>$/,
    /^\*+$/,
    /^\.{3,}$/,
    /(your|my)[-_ ]?.*here/i,
    /^(changeme|change_me|todo|fixme|placeholder|example|sample|dummy|fake|test|redacted|n\/a|none|null|undefined)$/i
  ]
  return placeholderPatterns.some((re) => re.test(value))
}

/**
 * generic(medium) 매치의 값 자체가 이미 고신뢰 패턴 중 하나와 일치하면
 * generic finding은 만들지 않는다 -- 같은 비밀을 high+medium 두 번 보고하는
 * 중복(노이즈)을 피한다(예: `TOKEN=ghp_...`는 github-pat 하나로만 보고).
 */
function looksLikeHighConfidenceValue(value: string): boolean {
  return HIGH_CONFIDENCE_PATTERNS.some((def) => {
    def.regex.lastIndex = 0
    return def.regex.test(value)
  })
}

/**
 * medium(경고) 층 -- `PASSWORD=`/`SECRET=`/`API_KEY=`/`TOKEN=` 류 할당 뒤에
 * 실제 값처럼 보이는 문자열. 이 층의 설계 목표는 오탐 억제다: `$VAR` 참조,
 * 빈 값, 명백한 플레이스홀더는 전부 제외한다.
 */
// 주의: 접두어 그룹은 `*?`(0회 이상, lazy)여야 한다 -- 식별자가 "API_KEY"처럼
// 접두어 없이 바로 alternation으로 시작하는 경우, 앞에 강제로 1글자를 소비하는
// 그룹을 두면 그 한 글자가 "API"의 "A"를 먹어버려 alternation 자체가 깨진다.
const GENERIC_ASSIGNMENT_RE =
  /\b([A-Za-z0-9_]*?(?:PASSWORD|SECRET|API[_-]?KEY|TOKEN|ACCESS[_-]?KEY)[A-Za-z0-9_]{0,20})\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|(\S+))/gi

function scanGenericAssignmentsInLine(line: string, path: string, lineNo: number): SecretFinding[] {
  const findings: SecretFinding[] = []
  GENERIC_ASSIGNMENT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = GENERIC_ASSIGNMENT_RE.exec(line)) !== null) {
    const key = m[1]
    const value = m[2] ?? m[3] ?? m[4] ?? ''
    if (!isPlaceholderOrEmptyValue(value) && !looksLikeHighConfidenceValue(value)) {
      findings.push({
        path,
        line: lineNo,
        kind: 'generic-secret-assignment',
        confidence: 'medium',
        label: `환경변수/설정 할당에 잠재적 비밀 값 (${key})`,
        maskedExcerpt: `${key}=****`
      })
    }
    if (m[0].length === 0) GENERIC_ASSIGNMENT_RE.lastIndex += 1
  }
  return findings
}

/** 텍스트 본문 하나를 스캔한다 -- 파일 I/O 없는 순수 함수(테스트 용이). */
export function scanTextForSecrets(content: string, path: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = content.split('\n')
  lines.forEach((line, idx) => {
    const lineNo = idx + 1
    for (const def of HIGH_CONFIDENCE_PATTERNS) {
      def.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = def.regex.exec(line)) !== null) {
        findings.push({
          path,
          line: lineNo,
          kind: def.kind,
          confidence: 'high',
          label: def.label,
          maskedExcerpt: def.mask(m[0])
        })
        if (m[0].length === 0) def.regex.lastIndex += 1
      }
    }
    findings.push(...scanGenericAssignmentsInLine(line, path, lineNo))
  })
  return findings
}

/**
 * 널 바이트가 있으면 바이너리로 간주한다 -- 텍스트 파일은 널 바이트를 포함하지
 * 않는다는 통상적 휴리스틱(git·grep -I 등이 쓰는 것과 동일한 원칙). 샘플만
 * 검사해 큰 파일에서도 빠르다.
 */
export function isLikelyBinary(buf: Buffer, sampleSize = 8000): boolean {
  const len = Math.min(buf.length, sampleSize)
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

/** 파일 하나를 스캔한다 -- 바이너리·크기초과는 findings 없이 skip 사유로 반환. */
export function scanFileForSecrets(absPath: string, displayPath: string): FileScanOutcome {
  const stat = fs.statSync(absPath)
  if (stat.size > MAX_SCAN_BYTES) {
    return { kind: 'skipped-too-large', sizeBytes: stat.size }
  }
  const buf = fs.readFileSync(absPath)
  if (isLikelyBinary(buf)) {
    return { kind: 'skipped-binary' }
  }
  return { kind: 'findings', findings: scanTextForSecrets(buf.toString('utf-8'), displayPath) }
}

function isDanglingSymlink(p: string): boolean {
  try {
    const isLink = fs.lstatSync(p).isSymbolicLink()
    if (!isLink) return false
    return !fs.existsSync(p)
  } catch {
    return true
  }
}

export interface TreeScanResult {
  readonly findings: readonly SecretFinding[]
  /** 스캔에서 제외된(바이너리·크기초과) 파일 수 -- 차단 사유는 아니다. */
  readonly skippedCount: number
}

/**
 * 파일 또는 디렉터리 트리를 재귀 스캔한다. dotfiles capability처럼 한 entry가
 * 디렉터리 전체일 수 있어 트리 전체를 훑어야 한다(capture.ts의
 * `copyTreeMirror`와 동일한 순회 원칙 -- 다만 이쪽은 읽기 전용).
 *
 * @param absPath 실제 파일시스템 경로 (홈 확장 후).
 * @param displayPath 보고에 쓸 표시 경로 (예: "~/.config/foo") -- 디렉터리
 *   내부 파일은 `${displayPath}/${상대경로}`로 확장된다.
 */
export function scanTreeForSecrets(absPath: string, displayPath: string): TreeScanResult {
  const findings: SecretFinding[] = []
  let skippedCount = 0

  function walk(currentAbs: string, currentDisplay: string): void {
    if (isDanglingSymlink(currentAbs)) return
    let stat: fs.Stats
    try {
      stat = fs.statSync(currentAbs)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(currentAbs)) {
        // .git 내부(오브젝트·팩 등)는 스캔 대상이 아니다 -- push 게이트용
        // manifest 전체 스캔이 이 함수를 재사용할 때 git 내부 구조를 훑지
        // 않기 위함(denylist도 애초에 이런 메타 디렉터리를 다루지 않는다).
        if (name === '.git') continue
        walk(path.join(currentAbs, name), currentDisplay ? `${currentDisplay}/${name}` : name)
      }
      return
    }
    if (!stat.isFile()) return // 소켓·디바이스 등은 스캔 대상 아님
    const outcome = scanFileForSecrets(currentAbs, currentDisplay)
    if (outcome.kind === 'findings') {
      findings.push(...outcome.findings)
    } else {
      skippedCount += 1
    }
  }

  walk(absPath, displayPath)
  return { findings, skippedCount }
}
