'use client'

import { useQuery } from '@tanstack/react-query'
import { getTenantAction, listProcedureTypesAction, listConsentTemplatesAction } from '@/actions/tenants'
import { listAllProductsAction } from '@/actions/products-catalog'
import { listTenantUsersAction } from '@/actions/users'
import { queryKeys } from './query-keys'

export function useTenant() {
  return useQuery({
    queryKey: queryKeys.settings.tenant,
    queryFn: () => getTenantAction(),
  })
}

export function useProcedureTypes() {
  return useQuery({
    queryKey: queryKeys.settings.procedureTypes,
    queryFn: () => listProcedureTypesAction(),
  })
}

export function useProducts() {
  return useQuery({
    queryKey: queryKeys.settings.products,
    queryFn: () => listAllProductsAction(),
  })
}

export function useTenantUsers() {
  return useQuery({
    queryKey: queryKeys.settings.members,
    queryFn: () => listTenantUsersAction(),
  })
}

export function useConsentTemplates() {
  return useQuery({
    queryKey: queryKeys.settings.consentTemplates,
    queryFn: () => listConsentTemplatesAction(),
  })
}
