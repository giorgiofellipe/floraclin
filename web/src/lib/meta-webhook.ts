import crypto from 'crypto'

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string,
): boolean {
  const expectedBuf = Buffer.from(
    `sha256=${crypto.createHmac('sha256', appSecret).update(payload).digest('hex')}`,
  )
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) return false
  return crypto.timingSafeEqual(expectedBuf, actualBuf)
}
