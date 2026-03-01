export interface ApiKey {
    id: string;
    name: string;
    createdAt: string;
    expiresAt: string | null;
}

export interface CreateApiKeyRequest {
    name: string;
    expiresAt?: string;
}

export interface CreateApiKeyResponse {
    apiKey: string;
    id: string;
    name: string;
}

export interface DeleteApiKeyResponse {
    message: string;
}
