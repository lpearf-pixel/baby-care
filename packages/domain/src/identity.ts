export type Relationship = 'dad' | 'mom' | 'nanny';

export type PermissionLevel = 'family_admin' | 'caregiver';

export type Capability =
  | 'family.read'
  | 'family.update'
  | 'baby.read'
  | 'baby.update'
  | 'members.read'
  | 'members.manage'
  | 'credentials.reset_nanny'
  | 'care.read'
  | 'care.write'
  | 'family.export';
