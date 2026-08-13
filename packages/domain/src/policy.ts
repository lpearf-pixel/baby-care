import type { Capability, PermissionLevel } from './identity.js';

const caregiverCapabilities = new Set<Capability>([
  'family.read',
  'baby.read',
  'members.read',
]);

export function can(permission: PermissionLevel, capability: Capability): boolean {
  if (permission === 'family_admin') return true;
  return caregiverCapabilities.has(capability);
}
