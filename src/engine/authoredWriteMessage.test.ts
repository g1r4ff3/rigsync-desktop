import { describe, expect, it } from 'vitest'
import {
  hostLayerMoveCommitMessage,
  ignoreToggleBulkCommitMessage,
  ignoreToggleCommitMessage
} from './authoredWriteMessage'

describe('authoredWriteMessage (WS5 커밋 메시지 어휘)', () => {
  it('ignoreToggleCommitMessage: on/off를 ignored로 인코딩한다', () => {
    expect(ignoreToggleCommitMessage('lab-main', 'apt', 'v4l-utils', true)).toBe(
      'ignore: lab-main apt:v4l-utils (on)'
    )
    expect(ignoreToggleCommitMessage('lab-main', 'apt', 'v4l-utils', false)).toBe(
      'ignore: lab-main apt:v4l-utils (off)'
    )
  })

  it('ignoreToggleBulkCommitMessage: N건을 담는다', () => {
    expect(ignoreToggleBulkCommitMessage('lab-main', 'apt', 3)).toBe('ignore: lab-main apt 3건')
  })

  it('hostLayerMoveCommitMessage: host/common 방향을 인코딩한다', () => {
    expect(hostLayerMoveCommitMessage('lab-main', 'dotfiles', '~/.zshrc', 'host')).toBe(
      'host-layer: lab-main dotfiles:~/.zshrc (host)'
    )
    expect(
      hostLayerMoveCommitMessage('lab-main', 'services', 'cliproxyapi.service', 'common')
    ).toBe('host-layer: lab-main services:cliproxyapi.service (common)')
  })
})
