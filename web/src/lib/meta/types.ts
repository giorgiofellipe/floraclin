export const META_GRAPH_VERSION = 'v21.0'

/** PageView exists only for the "Testar conexão" probe and is never written to the outbox. */
export type MetaEventName = 'Lead' | 'Contact' | 'Schedule' | 'Purchase' | 'PageView'

export type MetaActionSource = 'business_messaging' | 'website' | 'system_generated'

export interface MetaUserData {
  em?: string[]
  ph?: string[]
  fn?: string[]
  ln?: string[]
  external_id?: string[]
  client_ip_address?: string
  client_user_agent?: string
  fbp?: string
  fbc?: string
  /** Never hashed. Meta's parameter reference marks this "Do not hash". */
  ctwa_clid?: string
}

export interface MetaCustomData {
  value?: number
  currency?: string
}

export interface MetaEventPayload {
  event_name: MetaEventName
  event_time: number
  event_id: string
  action_source: MetaActionSource
  /** Required alongside action_source 'business_messaging'. */
  messaging_channel?: 'whatsapp'
  event_source_url?: string
  user_data: MetaUserData
  custom_data?: MetaCustomData
}

export interface MetaCapiTarget {
  datasetId: string
  accessToken: string
  testEventCode?: string | null
}

/**
 * `message` is the line every caller shows or stores. Meta puts the generic
 * "Invalid parameter" in `error.message` and names the offending field in
 * `error_user_msg`, so the parser prefers the latter when it is present and
 * keeps the raw fields here for whoever wants them.
 */
export interface MetaCapiFailure {
  ok: false
  message: string
  errorUserTitle?: string
  errorUserMsg?: string
  errorSubcode?: number
  fbTraceId?: string
}

export type MetaCapiResult =
  | { ok: true; eventsReceived: number; fbTraceId?: string }
  | (MetaCapiFailure & { kind: 'auth' })
  | (MetaCapiFailure & { kind: 'invalid' })
  | (MetaCapiFailure & { kind: 'transient' })
