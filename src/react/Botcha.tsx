import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import type { ImRobotConfig, ImRobotToken, Challenge } from '../core/types'
import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { formatPipeline } from '../core/operations'
import { getStyles, ROBOT_SVG } from '../styles'

export interface ImRobotProps {
  difficulty?: 'easy' | 'medium' | 'hard'
  theme?: 'light' | 'dark'
  ttl?: number
  onVerified?: (token: ImRobotToken) => void
  onError?: (error: Error) => void
}

export function ImRobot({
  difficulty = 'medium',
  theme = 'light',
  ttl = 300_000,
  onVerified,
  onError,
}: ImRobotProps) {
  const [challenge, setChallenge] = useState<Challenge>(() =>
    generateChallenge({ difficulty, ttl }),
  )
  const [answer, setAnswer] = useState('')
  const [status, setStatus] = useState<'idle' | 'verified' | 'failed'>('idle')
  const startTime = useRef(Date.now())

  const css = useMemo(() => getStyles(theme), [theme])
  const display = useMemo(
    () => formatPipeline(challenge.seed, challenge.pipeline),
    [challenge],
  )
  const challengeJson = useMemo(() => JSON.stringify(challenge), [challenge])

  const handleVerify = useCallback(() => {
    const trimmed = answer.trim()
    if (!trimmed) return

    if (verifyAnswer(challenge, trimmed)) {
      setStatus('verified')
      const token = createToken(challenge, trimmed, startTime.current)
      onVerified?.(token)
    } else {
      setStatus('failed')
      onError?.(new Error('Verification failed'))
    }
  }, [answer, challenge, onVerified, onError])

  const handleRetry = useCallback(() => {
    setChallenge(generateChallenge({ difficulty, ttl }))
    setAnswer('')
    setStatus('idle')
    startTime.current = Date.now()
  }, [difficulty, ttl])

  useEffect(() => {
    const el = document.querySelector('[data-imrobot-challenge]')
    if (el) el.setAttribute('data-imrobot-challenge', challengeJson)
  }, [challengeJson])

  return (
    <>
      <style>{css}</style>
      <div
        className="imrobot"
        data-imrobot-challenge={challengeJson}
        role="region"
        aria-label="ImRobot verification challenge"
      >
        <div className="imrobot-header">
          <span
            className="imrobot-icon"
            dangerouslySetInnerHTML={{ __html: ROBOT_SVG }}
          />
          <span>Prove you&apos;re a robot</span>
        </div>

        <div className="imrobot-challenge" aria-label="Challenge pipeline">
          {display}
        </div>

        {status !== 'verified' && (
          <div className="imrobot-row">
            <input
              className="imrobot-input"
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
              placeholder="Enter pipeline result..."
              aria-label="Challenge answer"
              autoComplete="off"
            />
            <button
              className="imrobot-btn"
              onClick={handleVerify}
              disabled={!answer.trim()}
            >
              Verify
            </button>
          </div>
        )}

        <div className="imrobot-footer">
          <div>
            {status === 'verified' && (
              <span className="imrobot-status imrobot-status--verified">
                &#10003; Verified: You are a robot
              </span>
            )}
            {status === 'failed' && (
              <span className="imrobot-status imrobot-status--failed">
                &#10007; Failed —{' '}
                <button
                  onClick={handleRetry}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                  }}
                >
                  try again
                </button>
              </span>
            )}
          </div>
          <span className="imrobot-brand">imrobot</span>
        </div>
      </div>
    </>
  )
}
