import { getRequestConfig } from 'next-intl/server'

export default getRequestConfig(async () => {
  return {
    locale: 'pt-BR',
    messages: (await import('../i18n/messages/pt-BR.json')).default,
  }
})
