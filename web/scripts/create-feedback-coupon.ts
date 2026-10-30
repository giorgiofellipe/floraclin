/**
 * One-off: create the feedback reward Stripe coupon (50% for 3 months) and its
 * promotion code (idempotent). Prints the env line to set afterwards.
 *
 * Test keys run freely. A live key needs `--live` and refuses to run under CI
 * or Vercel; it prints the account and waits 5 s before writing.
 *
 *   pnpm --filter @floraclin/web feedback:create-coupon
 *   pnpm --filter @floraclin/web feedback:create-coupon -- --live
 */
import Stripe from 'stripe'
import { assertRunAllowed, keyMode } from '@/lib/referral/coupon-setup'
import { setupFeedbackCoupon, type FeedbackCouponSetupDeps } from '@/lib/feedback-coupon-setup'

function isMissing(err: unknown): boolean {
  return err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing'
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')

  const mode = keyMode(key)
  assertRunAllowed(mode, process.argv, process.env)
  console.log(`Stripe ${mode} mode`)

  const stripe = new Stripe(key)

  if (mode === 'live') {
    const account = await stripe.accounts.retrieveCurrent()
    console.log(`LIVE MODE: account ${account.id}. Writing in 5 seconds (Ctrl+C to abort)...`)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  const deps: FeedbackCouponSetupDeps = {
    async retrieveCoupon(id) {
      try {
        return await stripe.coupons.retrieve(id)
      } catch (err) {
        if (isMissing(err)) return null
        throw err
      }
    },
    createCoupon: (spec) => stripe.coupons.create(spec),
    async findPromotionCode(couponId, code) {
      const list = await stripe.promotionCodes.list({ code, active: true, coupon: couponId, limit: 1 })
      return list.data[0] ?? null
    },
    createPromotionCode: ({ couponId, code }) =>
      stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: couponId },
        code,
        restrictions: { first_time_transaction: true },
        metadata: { purpose: 'feedback_reward', app: 'floraclin' },
      }),
    log: (line) => console.log(line),
  }

  const { envLines } = await setupFeedbackCoupon(deps)
  console.log(`\nSet this env var (${mode} mode):\n`)
  for (const line of envLines) console.log(line)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
