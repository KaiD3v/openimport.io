export type ApiKeyCredential = {
  type: 'apiKey';
};

export type ImportAccessTokenCredential = {
  type: 'importAccessToken';
  importSessionId: string;
  accessTokenId: string;
};

export type AuthenticatedCredential =
  | ApiKeyCredential
  | ImportAccessTokenCredential;

export type AuthenticatedOrganization = {
  organizationId: string;
  apiKeyId: string;
  apiKeyName: string;
  credential: AuthenticatedCredential;
};
