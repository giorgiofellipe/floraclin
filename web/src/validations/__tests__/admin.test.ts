import { describe, it, expect } from 'vitest'
import {
  adminSearchSchema,
  createTenantSchema,
  updateTenantSchema,
  createAdminUserSchema,
  updateAdminUserSchema,
  addMembershipSchema,
  impersonateSchema,
} from '../admin'

const UUID = '550e8400-e29b-41d4-a716-446655440000'
const UUID2 = '550e8400-e29b-41d4-a716-446655440001'

describe('adminSearchSchema', () => {
  it('passes with no fields (all optional with defaults)', () => {
    const result = adminSearchSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('defaults search to empty string', () => {
    const result = adminSearchSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.search).toBe('')
    }
  })

  it('defaults page to 1', () => {
    const result = adminSearchSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.page).toBe(1)
    }
  })

  it('defaults limit to 20', () => {
    const result = adminSearchSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.limit).toBe(20)
    }
  })

  it('passes with all fields provided', () => {
    const result = adminSearchSchema.safeParse({ search: 'flora', page: 2, limit: 50 })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.search).toBe('flora')
      expect(result.data.page).toBe(2)
      expect(result.data.limit).toBe(50)
    }
  })

  it('fails when page is zero', () => {
    const result = adminSearchSchema.safeParse({ page: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when page is negative', () => {
    const result = adminSearchSchema.safeParse({ page: -1 })
    expect(result.success).toBe(false)
  })

  it('fails when page is not an integer', () => {
    const result = adminSearchSchema.safeParse({ page: 1.5 })
    expect(result.success).toBe(false)
  })

  it('fails when limit is zero', () => {
    const result = adminSearchSchema.safeParse({ limit: 0 })
    expect(result.success).toBe(false)
  })

  it('fails when limit exceeds 100', () => {
    const result = adminSearchSchema.safeParse({ limit: 101 })
    expect(result.success).toBe(false)
  })

  it('passes with limit of 100', () => {
    const result = adminSearchSchema.safeParse({ limit: 100 })
    expect(result.success).toBe(true)
  })
})

describe('createTenantSchema', () => {
  const validData = {
    name: 'Clinica Flora',
    ownerEmail: 'owner@flora.com',
    ownerName: 'Dr. Flora',
  }

  it('passes with valid data (no slug)', () => {
    const result = createTenantSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with optional slug', () => {
    const result = createTenantSchema.safeParse({ ...validData, slug: 'clinica-flora' })
    expect(result.success).toBe(true)
  })

  it('fails when name is missing', () => {
    const { name, ...rest } = validData
    const result = createTenantSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when name is empty', () => {
    const result = createTenantSchema.safeParse({ ...validData, name: '' })
    expect(result.success).toBe(false)
  })

  it('fails when ownerEmail is missing', () => {
    const { ownerEmail, ...rest } = validData
    const result = createTenantSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when ownerEmail is invalid', () => {
    const result = createTenantSchema.safeParse({ ...validData, ownerEmail: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('fails when ownerName is missing', () => {
    const { ownerName, ...rest } = validData
    const result = createTenantSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when ownerName is empty', () => {
    const result = createTenantSchema.safeParse({ ...validData, ownerName: '' })
    expect(result.success).toBe(false)
  })

  it('fails when slug contains uppercase letters', () => {
    const result = createTenantSchema.safeParse({ ...validData, slug: 'Clinica-Flora' })
    expect(result.success).toBe(false)
  })

  it('fails when slug contains spaces', () => {
    const result = createTenantSchema.safeParse({ ...validData, slug: 'clinica flora' })
    expect(result.success).toBe(false)
  })

  it('fails when slug contains special characters', () => {
    const result = createTenantSchema.safeParse({ ...validData, slug: 'clinica_flora!' })
    expect(result.success).toBe(false)
  })

  it('passes with slug containing numbers and hyphens', () => {
    const result = createTenantSchema.safeParse({ ...validData, slug: 'clinica-flora-123' })
    expect(result.success).toBe(true)
  })

  it('returns correct error message for invalid email', () => {
    const result = createTenantSchema.safeParse({ ...validData, ownerEmail: 'bad' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const emailError = result.error.issues.find((i) => i.path.includes('ownerEmail'))
      expect(emailError?.message).toBe('E-mail inválido')
    }
  })
})

describe('updateTenantSchema', () => {
  it('passes with no fields (all optional)', () => {
    const result = updateTenantSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('passes with name only', () => {
    const result = updateTenantSchema.safeParse({ name: 'Nova Clinica' })
    expect(result.success).toBe(true)
  })

  it('passes with slug only', () => {
    const result = updateTenantSchema.safeParse({ slug: 'nova-clinica' })
    expect(result.success).toBe(true)
  })

  it('passes with settings only', () => {
    const result = updateTenantSchema.safeParse({ settings: { theme: 'dark', maxUsers: 10 } })
    expect(result.success).toBe(true)
  })

  it('passes with isActive only', () => {
    const result = updateTenantSchema.safeParse({ isActive: false })
    expect(result.success).toBe(true)
  })

  it('passes with all fields', () => {
    const result = updateTenantSchema.safeParse({
      name: 'Nova Clinica',
      slug: 'nova-clinica',
      settings: { theme: 'light' },
      isActive: true,
    })
    expect(result.success).toBe(true)
  })

  it('fails when name is empty', () => {
    const result = updateTenantSchema.safeParse({ name: '' })
    expect(result.success).toBe(false)
  })

  it('fails when slug is invalid', () => {
    const result = updateTenantSchema.safeParse({ slug: 'INVALID SLUG' })
    expect(result.success).toBe(false)
  })

  it('fails when isActive is not a boolean', () => {
    const result = updateTenantSchema.safeParse({ isActive: 'yes' })
    expect(result.success).toBe(false)
  })
})

describe('createAdminUserSchema', () => {
  const validData = {
    email: 'user@flora.com',
    fullName: 'Dr. Flora',
    tenantId: UUID,
    role: 'practitioner',
  }

  it('passes with valid data', () => {
    const result = createAdminUserSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('passes with optional phone', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, phone: '+5511999999999' })
    expect(result.success).toBe(true)
  })

  it('passes without phone', () => {
    const result = createAdminUserSchema.safeParse(validData)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.phone).toBeUndefined()
    }
  })

  it('accepts all valid roles', () => {
    const roles = ['owner', 'practitioner', 'receptionist', 'financial']
    for (const role of roles) {
      const result = createAdminUserSchema.safeParse({ ...validData, role })
      expect(result.success).toBe(true)
    }
  })

  it('fails when email is missing', () => {
    const { email, ...rest } = validData
    const result = createAdminUserSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when email is invalid', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, email: 'not-email' })
    expect(result.success).toBe(false)
  })

  it('fails when fullName is missing', () => {
    const { fullName, ...rest } = validData
    const result = createAdminUserSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when fullName is empty', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, fullName: '' })
    expect(result.success).toBe(false)
  })

  it('fails when tenantId is missing', () => {
    const { tenantId, ...rest } = validData
    const result = createAdminUserSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when tenantId is not a uuid', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, tenantId: 'not-uuid' })
    expect(result.success).toBe(false)
  })

  it('fails when role is missing', () => {
    const { role, ...rest } = validData
    const result = createAdminUserSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when role is invalid', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, role: 'admin' })
    expect(result.success).toBe(false)
  })

  it('returns correct error message for invalid email', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, email: 'bad' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const emailError = result.error.issues.find((i) => i.path.includes('email'))
      expect(emailError?.message).toBe('E-mail inválido')
    }
  })

  it('returns correct error message for invalid tenantId', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, tenantId: 'bad' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const tenantError = result.error.issues.find((i) => i.path.includes('tenantId'))
      expect(tenantError?.message).toBe('Clínica inválida')
    }
  })

  it('returns correct error message for invalid role', () => {
    const result = createAdminUserSchema.safeParse({ ...validData, role: 'admin' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const roleError = result.error.issues.find((i) => i.path.includes('role'))
      expect(roleError?.message).toBe('Perfil inválido')
    }
  })
})

describe('updateAdminUserSchema', () => {
  it('passes with no fields (all optional)', () => {
    const result = updateAdminUserSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('passes with fullName only', () => {
    const result = updateAdminUserSchema.safeParse({ fullName: 'Dr. Flora' })
    expect(result.success).toBe(true)
  })

  it('passes with phone only', () => {
    const result = updateAdminUserSchema.safeParse({ phone: '+5511999999999' })
    expect(result.success).toBe(true)
  })

  it('passes with isPlatformAdmin only', () => {
    const result = updateAdminUserSchema.safeParse({ isPlatformAdmin: true })
    expect(result.success).toBe(true)
  })

  it('passes with all fields', () => {
    const result = updateAdminUserSchema.safeParse({
      fullName: 'Dr. Flora',
      phone: '+5511999999999',
      isPlatformAdmin: false,
    })
    expect(result.success).toBe(true)
  })

  it('fails when fullName is empty', () => {
    const result = updateAdminUserSchema.safeParse({ fullName: '' })
    expect(result.success).toBe(false)
  })

  it('fails when isPlatformAdmin is not a boolean', () => {
    const result = updateAdminUserSchema.safeParse({ isPlatformAdmin: 'yes' })
    expect(result.success).toBe(false)
  })
})

describe('addMembershipSchema', () => {
  const validData = {
    tenantId: UUID,
    role: 'receptionist',
  }

  it('passes with valid data', () => {
    const result = addMembershipSchema.safeParse(validData)
    expect(result.success).toBe(true)
  })

  it('accepts all valid roles', () => {
    const roles = ['owner', 'practitioner', 'receptionist', 'financial']
    for (const role of roles) {
      const result = addMembershipSchema.safeParse({ ...validData, role })
      expect(result.success).toBe(true)
    }
  })

  it('fails when tenantId is missing', () => {
    const { tenantId, ...rest } = validData
    const result = addMembershipSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when tenantId is not a uuid', () => {
    const result = addMembershipSchema.safeParse({ ...validData, tenantId: 'not-uuid' })
    expect(result.success).toBe(false)
  })

  it('fails when role is missing', () => {
    const { role, ...rest } = validData
    const result = addMembershipSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('fails when role is invalid', () => {
    const result = addMembershipSchema.safeParse({ ...validData, role: 'superadmin' })
    expect(result.success).toBe(false)
  })

  it('returns correct error message for invalid tenantId', () => {
    const result = addMembershipSchema.safeParse({ ...validData, tenantId: 'bad' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const tenantError = result.error.issues.find((i) => i.path.includes('tenantId'))
      expect(tenantError?.message).toBe('Clínica inválida')
    }
  })

  it('returns correct error message for invalid role', () => {
    const result = addMembershipSchema.safeParse({ ...validData, role: 'manager' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const roleError = result.error.issues.find((i) => i.path.includes('role'))
      expect(roleError?.message).toBe('Perfil inválido')
    }
  })
})

describe('impersonateSchema', () => {
  it('passes with valid tenantId', () => {
    const result = impersonateSchema.safeParse({ tenantId: UUID })
    expect(result.success).toBe(true)
  })

  it('fails when tenantId is missing', () => {
    const result = impersonateSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('fails when tenantId is not a uuid', () => {
    const result = impersonateSchema.safeParse({ tenantId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('fails when tenantId is empty string', () => {
    const result = impersonateSchema.safeParse({ tenantId: '' })
    expect(result.success).toBe(false)
  })

  it('returns correct error message for invalid tenantId', () => {
    const result = impersonateSchema.safeParse({ tenantId: 'bad' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const tenantError = result.error.issues.find((i) => i.path.includes('tenantId'))
      expect(tenantError?.message).toBe('Clínica inválida')
    }
  })

  it('passes with a different valid uuid', () => {
    const result = impersonateSchema.safeParse({ tenantId: UUID2 })
    expect(result.success).toBe(true)
  })
})
