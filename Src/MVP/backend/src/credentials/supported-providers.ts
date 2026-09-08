// `provider` stays a free string on the schema and DTO — adding a provider
// later means adding an entry here, not a schema migration (§4.1). Still
// validated at the API boundary against this list, the same way RegisterDto
// validates `role` against USER_ROLES.
export const SUPPORTED_PROVIDERS = ['GITHUB'] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];
