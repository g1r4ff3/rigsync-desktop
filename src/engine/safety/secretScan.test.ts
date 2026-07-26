import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isLikelyBinary,
  MAX_SCAN_BYTES,
  scanFileForSecrets,
  scanTextForSecrets,
  scanTreeForSecrets,
  type SecretFinding
} from './secretScan'

// 픽스처 주의(★): 이 repo는 public이다(g1r4ff3/rigsync-desktop). 아래 더미
// 토큰은 전부 `.repeat()`로 조립해 소스 어디에도 실제 토큰 형식과 같은
// 연속 리터럴이 나타나지 않게 하고, 반복 단어("FAKE")를 써서 사람이 봐도
// 명백한 더미임을 드러낸다 -- 진짜 토큰은 고엔트로피 무작위 문자열이라
// 반복 패턴이 아니다.
const FAKE_GITHUB_CLASSIC = 'ghp_' + 'FAKE'.repeat(9) // 36 chars
const FAKE_GITHUB_FINEGRAINED = 'github_pat_' + 'FAKE'.repeat(6)
const FAKE_AWS_KEY = 'AKIA' + 'FAKE'.repeat(4) // 16 uppercase chars
const FAKE_SLACK_TOKEN = 'xoxb-' + 'FAKE1'.repeat(3)
const FAKE_GOOGLE_KEY = 'AIza' + 'FAKE'.repeat(9) // 36 chars (>=35)
const FAKE_ANTHROPIC_KEY = 'sk-ant-' + 'FAKE'.repeat(6)
const FAKE_OPENAI_KEY = 'sk-' + 'FAKE'.repeat(6)
const FAKE_PEM_HEADER = '-----BEGIN ' + 'RSA PRIVATE KEY' + '-----'

function findingsOf(content: string): SecretFinding[] {
  return scanTextForSecrets(content, 'fixture.txt')
}

describe('scanTextForSecrets — high-confidence patterns', () => {
  it('detects a GitHub classic personal access token', () => {
    const findings = findingsOf(`export TOKEN=${FAKE_GITHUB_CLASSIC}\n`)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ kind: 'github-pat', confidence: 'high', line: 1 })
  })

  it('detects a GitHub fine-grained personal access token', () => {
    const findings = findingsOf(`${FAKE_GITHUB_FINEGRAINED}\n`)
    expect(findings.some((f) => f.kind === 'github-pat')).toBe(true)
  })

  it('detects an AWS access key ID', () => {
    const findings = findingsOf(`aws_access_key_id = ${FAKE_AWS_KEY}\n`)
    expect(findings.some((f) => f.kind === 'aws-access-key')).toBe(true)
  })

  it('detects a Slack token', () => {
    const findings = findingsOf(`SLACK_TOKEN=${FAKE_SLACK_TOKEN}\n`)
    expect(findings.some((f) => f.kind === 'slack-token')).toBe(true)
  })

  it('detects a Google API key', () => {
    const findings = findingsOf(`key: ${FAKE_GOOGLE_KEY}\n`)
    expect(findings.some((f) => f.kind === 'google-api-key')).toBe(true)
  })

  it('detects an Anthropic API key and does not double-count it as OpenAI', () => {
    const findings = findingsOf(`${FAKE_ANTHROPIC_KEY}\n`)
    expect(findings.filter((f) => f.kind === 'anthropic-api-key')).toHaveLength(1)
    expect(findings.filter((f) => f.kind === 'openai-api-key')).toHaveLength(0)
  })

  it('detects an OpenAI API key', () => {
    const findings = findingsOf(`${FAKE_OPENAI_KEY}\n`)
    expect(findings.some((f) => f.kind === 'openai-api-key')).toBe(true)
  })

  it('detects a PEM private key header', () => {
    const findings = findingsOf(`${FAKE_PEM_HEADER}\nMIIBogIBAAKCA...\n`)
    expect(findings.some((f) => f.kind === 'pem-private-key')).toBe(true)
  })

  it('reports the correct 1-based line number', () => {
    const findings = findingsOf(`line one\nline two\n${FAKE_GITHUB_CLASSIC}\n`)
    expect(findings[0].line).toBe(3)
  })
})

describe('scanTextForSecrets — value non-exposure (absolute rule)', () => {
  it('never includes the raw matched value anywhere in a finding', () => {
    const content = `export GH=${FAKE_GITHUB_CLASSIC}\nPASSWORD=SuperSecretValue123\n`
    const findings = findingsOf(content)
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      const serialized = JSON.stringify(f)
      expect(serialized).not.toContain(FAKE_GITHUB_CLASSIC)
      expect(serialized).not.toContain('SuperSecretValue123')
    }
  })

  it('masks a high-confidence finding to only the known public prefix + fixed asterisks', () => {
    const findings = findingsOf(FAKE_GITHUB_CLASSIC)
    expect(findings[0].maskedExcerpt).toBe('ghp_****')
  })

  it('masks a medium-confidence finding to "<key>=****" with no value characters', () => {
    const findings = findingsOf('MY_API_TOKEN=SuperSecretValue123')
    const medium = findings.find((f) => f.confidence === 'medium')
    expect(medium).toBeDefined()
    expect(medium!.maskedExcerpt).toBe('MY_API_TOKEN=****')
    expect(medium!.maskedExcerpt).not.toContain('SuperSecretValue123')
  })
})

describe('scanTextForSecrets — medium-confidence generic assignment', () => {
  it('flags a PASSWORD assignment with a real-looking value', () => {
    const findings = findingsOf('DB_PASSWORD=hunter2isnotreal')
    expect(findings.some((f) => f.kind === 'generic-secret-assignment')).toBe(true)
  })

  it('flags a SECRET/API_KEY/TOKEN assignment', () => {
    expect(findingsOf('API_KEY=abcdefgh12345678').length).toBeGreaterThan(0)
    expect(findingsOf('MY_SECRET="anotherRealLookingValue"').length).toBeGreaterThan(0)
  })

  it('does NOT flag a $VAR reference', () => {
    expect(findingsOf('export GITHUB_TOKEN=$GITHUB_TOKEN')).toHaveLength(0)
  })

  it('does NOT flag a ${VAR} reference', () => {
    expect(findingsOf('TOKEN=${MY_TOKEN}')).toHaveLength(0)
  })

  it('does NOT flag an empty value', () => {
    expect(findingsOf('API_KEY=')).toHaveLength(0)
  })

  it('does NOT flag obvious placeholders', () => {
    expect(findingsOf('API_KEY=your-token-here')).toHaveLength(0)
    expect(findingsOf('API_KEY=xxxxxxxxxxxx')).toHaveLength(0)
    expect(findingsOf('API_KEY=<insert-token>')).toHaveLength(0)
    expect(findingsOf('API_KEY=CHANGEME')).toHaveLength(0)
    expect(findingsOf('API_KEY=placeholder')).toHaveLength(0)
  })

  it('does NOT flag an ordinary short/non-secret dotfile line', () => {
    expect(findingsOf('export EDITOR=vim')).toHaveLength(0)
    expect(findingsOf('alias ll="ls -la"')).toHaveLength(0)
  })
})

describe('isLikelyBinary', () => {
  it('detects a null byte within the sampled prefix', () => {
    expect(isLikelyBinary(Buffer.from([0x50, 0x4b, 0x00, 0x03]))).toBe(true)
  })

  it('does not flag ordinary UTF-8 text', () => {
    expect(isLikelyBinary(Buffer.from('export TOKEN=abc\n', 'utf-8'))).toBe(false)
  })
})

describe('scanFileForSecrets', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-secretscan-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('skips binary files without producing findings', () => {
    const p = path.join(dir, 'blob.bin')
    fs.writeFileSync(p, Buffer.from([0x00, 0x01, 0x02, 0x03]))
    const outcome = scanFileForSecrets(p, '~/.blob.bin')
    expect(outcome.kind).toBe('skipped-binary')
  })

  it('skips files larger than the size cap', () => {
    const p = path.join(dir, 'big.txt')
    fs.writeFileSync(p, 'a'.repeat(MAX_SCAN_BYTES + 1))
    const outcome = scanFileForSecrets(p, '~/.big.txt')
    expect(outcome.kind).toBe('skipped-too-large')
  })

  it('scans a small text file and finds a high-confidence secret', () => {
    const p = path.join(dir, '.zshrc')
    fs.writeFileSync(p, `export GITHUB_TOKEN=${FAKE_GITHUB_CLASSIC}\n`)
    const outcome = scanFileForSecrets(p, '~/.zshrc')
    expect(outcome.kind).toBe('findings')
    if (outcome.kind === 'findings') {
      expect(outcome.findings.some((f) => f.kind === 'github-pat')).toBe(true)
      expect(outcome.findings[0].path).toBe('~/.zshrc')
    }
  })
})

describe('scanTreeForSecrets', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-secretscan-tree-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('scans a single file entry', () => {
    const p = path.join(dir, '.zshrc')
    fs.writeFileSync(p, `TOKEN=${FAKE_GITHUB_CLASSIC}\n`)
    const result = scanTreeForSecrets(p, '~/.zshrc')
    expect(result.findings.some((f) => f.kind === 'github-pat')).toBe(true)
  })

  it('recursively scans a directory entry and prefixes each finding with its relative path', () => {
    const sub = path.join(dir, '.config', 'app')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(sub, 'clean.conf'), 'theme=dark\n')
    fs.writeFileSync(path.join(sub, 'secrets.conf'), `API_KEY=${FAKE_GITHUB_CLASSIC}\n`)

    const result = scanTreeForSecrets(sub, '~/.config/app')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].path).toBe('~/.config/app/secrets.conf')
  })

  it('counts skipped binary files without blocking on them', () => {
    fs.writeFileSync(path.join(dir, 'plain.txt'), 'hello world\n')
    fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([0x00, 0x01]))
    const result = scanTreeForSecrets(dir, '~/somedir')
    expect(result.findings).toHaveLength(0)
    expect(result.skippedCount).toBe(1)
  })
})
