// Rules for changing the public booking link (/c/<slug>), shared by the
// settings form and db/queries/booking-slugs.ts.

/**
 * For this many days after a clinic moves off a booking link, /c/<old> redirects
 * to its current one and no other clinic may take the old one.
 */
export const SLUG_RESERVATION_DAYS = 90
/** A clinic may change its booking link this many times in a rolling 24 h window. */
export const BOOKING_SLUG_CHANGES_PER_DAY = 3

export const BOOKING_SLUG_MESSAGES = {
  taken: 'Este link já está em uso. Escolha outro.',
  rateLimited: `Você já trocou o link ${BOOKING_SLUG_CHANGES_PER_DAY} vezes nas últimas 24 horas. Tente de novo mais tarde.`,
}
