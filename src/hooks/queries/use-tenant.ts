'use client'

import { useQuery } from '@tanstack/react-query'
import { getTenantAction } from '@/actions/tenants'
import { listTenantUsersAction } from '@/actions/users'

export function useTenant() {
  return useQuery({
    queryKey: ['tenant'],
    queryFn: () => getTenantAction(),
  })
}

export function useTenantUsers() {
  return useQuery({
    queryKey: ['tenant', 'users'],
    queryFn: () => listTenantUsersAction(),
  })
}
