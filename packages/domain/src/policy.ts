import type { Capability, PermissionLevel } from './identity.js';

const caregiverCapabilities = new Set<Capability>([
  'family.read',
  'baby.read',
  'members.read',
  'care.read',
  'care.write',
]);

export function can(permission: PermissionLevel, capability: Capability): boolean {
  if (permission === 'family_admin') return true;
  if (capability === 'family.export') return false;
  return caregiverCapabilities.has(capability);
}
