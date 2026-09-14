// `provider` stays a free string on the schema and DTO — adding a provider
// later means adding an entry here, not a schema migration (§4.1). Still
// validated at the API boundary against this list, the same way RegisterDto
// validates `role` against USER_ROLES.
//
// GITHUB carries a single secret (the PAT). SONARQUBE carries a small bundle
// — instance URL, project key, token, optional organization — so the two
// providers do not share a credential shape: see CreateCredentialDto for the
// per-provider validation and CredentialsService for how each is verified
// and stored. SONARQUBE is optional everywhere (it enriches DOCS prompts
// with quality metrics, it does not gate any route), which is why the route
// guards and CredentialBanner still track GITHUB alone.
export const SUPPORTED_PROVIDERS = ["GITHUB", "SONARQUBE"] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

// Named constant only for the provider with branching logic around it
// (per-provider verification and storage in CredentialsService). GITHUB
// callers already inline their own `const GITHUB_PROVIDER = "GITHUB"`.
export const SONARQUBE_PROVIDER: SupportedProvider = "SONARQUBE";
