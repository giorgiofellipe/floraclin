interface SignupTermsNoticeProps {
  lead: string
  /** The notice the legitimate-interest basis of the Meta conversion events relies on. */
  withAdsNotice?: boolean
}

export function SignupTermsNotice({ lead, withAdsNotice = false }: SignupTermsNoticeProps) {
  return (
    <p className="mt-3 text-center text-xs text-mid">
      {lead}, você concorda com os{' '}
      <a href="https://floraclin.com.br/termos" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        Termos de Uso
      </a>{' '}
      e a{' '}
      <a href="https://floraclin.com.br/privacidade" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        Política de Privacidade
      </a>
      .
      {withAdsNotice &&
        ' Informamos o cadastro e a assinatura à Meta, com e-mail em hash, para medir nossos anúncios. Você pode se opor pelo e-mail contato@floraclin.com.br.'}
    </p>
  )
}
