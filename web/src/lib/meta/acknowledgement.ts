/**
 * The LGPD acknowledgement a clinic owner accepts before the Meta integration
 * activates. Version and text live together, and in a module with no Node
 * imports, so the client card and the server routes cannot drift: the audit
 * log records the version, and the version has to mean one exact text.
 *
 * Bump the version whenever the text changes. Never edit the text in place.
 */
export const ACKNOWLEDGEMENT_VERSION = '2026-08-v1'

export const ACKNOWLEDGEMENT_TEXT =
  'A clínica é a controladora dos dados dos seus pacientes. Ao ativar esta ' +
  'integração, dados de contato (telefone e email) serão enviados de forma ' +
  'criptografada à Meta para medição de anúncios. A clínica é responsável ' +
  'pela base legal do tratamento perante seus pacientes.'
