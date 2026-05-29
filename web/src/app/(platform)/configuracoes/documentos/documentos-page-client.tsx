'use client'

import * as React from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentTemplateList } from '@/components/settings/document-template-list'

export function DocumentosPageClient() {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-charcoal">Modelos de Documentos</h1>
        <p className="text-sm text-mid">
          Modelos de receitas e atestados reutilizáveis pelos profissionais ao emitir
          documentos clínicos.
        </p>
      </header>

      <Tabs defaultValue="receita" className="space-y-4">
        <TabsList>
          <TabsTrigger value="receita">Receitas</TabsTrigger>
          <TabsTrigger value="atestado">Atestados</TabsTrigger>
        </TabsList>

        <TabsContent value="receita" className="space-y-4">
          <DocumentTemplateList kind="receita" />
        </TabsContent>

        <TabsContent value="atestado" className="space-y-4">
          <DocumentTemplateList kind="atestado" />
        </TabsContent>
      </Tabs>
    </div>
  )
}
